/**
 * T46a-3b 网关冒烟脚本（零依赖，用网关自带的 ws）。
 *
 * 覆盖率四个关键断言（对应任务卡 §四）：
 *   ① 合法 editor 能连上；
 *   ② 无 token / 错 token → 被拒（close 4403）；
 *   ③ 非成员（另一个账号，未加入该工作区）→ 被拒；
 *   ④ viewer 发出的写消息**不会**到达另一个客户端（真只读）。
 *
 * 前置：
 *   1) 后端在 :8000（且 backend/.env 里配了 COLLAB_INTERNAL_TOKEN）
 *   2) 网关在 :1235（docker compose --profile collab-auth up -d collab-gateway，
 *      或本地直跑：cd docker/collab-gateway && npm i && PORT=1235 UPSTREAM_WS=ws://localhost:1234 \
 *      BACKEND_URL=http://localhost:8000 JWT_SECRET=<与后端一致> COLLAB_INTERNAL_TOKEN=<同一串> node server.js）
 *   3) 一个已保存的设计稿 id（脚本用 room = design-<id>，与前端当前派生一致）
 *
 * 用法：
 *   cd docker/collab-gateway && npm i && node smoke.mjs --design 12 [--gateway ws://localhost:1235]
 */
import { WebSocket } from 'ws'

const args = Object.fromEntries(
  process.argv.slice(2).flatMap((a, i, arr) => (a.startsWith('--') ? [[a.slice(2), arr[i + 1]]] : [])),
)
const GATEWAY = args.gateway || 'ws://localhost:1235'
const BACKEND = args.backend || 'http://localhost:8000'
const DESIGN_ID = args.design
if (!DESIGN_ID) {
  console.error('用法：node smoke.mjs --design <设计稿id> [--gateway ws://localhost:1235] [--backend http://localhost:8000]')
  process.exit(2)
}
const ROOM = `design-${DESIGN_ID}`

async function register(username) {
  const resp = await fetch(`${BACKEND}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password: `${username}123` }),
  })
  if (resp.ok) return (await resp.json()).token
  const login = await fetch(`${BACKEND}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password: `${username}123` }),
  })
  if (!login.ok) throw new Error(`无法登录 ${username}: HTTP ${login.status}`)
  return (await login.json()).token
}

/**
 * 打开一个 WS。**必须区分"连上"与"被拒"**：
 * 旧版只看 `close` 事件，结果 4403 到达前就 resolve 了，closeCode 仍是 null → 全部误判（实测 1/5）。
 * 这里改成：先到的事件决定结论；并用 `expectDenied` 等待 close（带超时）。
 */
function open(room, token) {
  const url = `${GATEWAY}/${encodeURIComponent(room)}${token ? `?token=${encodeURIComponent(token)}` : ''}`
  const ws = new WebSocket(url)
  const state = { ws, closeCode: null, opened: false, firstEvent: null }
  const done = new Promise((resolve) => {
    ws.on('open', () => {
      state.opened = true
      state.firstEvent = 'open'
      resolve(state)
    })
    ws.on('close', (code) => {
      state.closeCode = code
      state.firstEvent = state.firstEvent ?? 'close'
      resolve(state)
    })
    ws.on('error', () => resolve(state))
  })
  return { state, done }
}

/** 期望被拒：等 close（最多 3000ms）。若期间连上了，判定失败。 */
async function expectDenied(room, token) {
  const { state } = open(room, token)
  const deadline = Date.now() + 3000
  while (Date.now() < deadline) {
    if (state.closeCode !== null || state.opened) break
    await new Promise((r) => setTimeout(r, 50))
  }
  if (state.opened && state.closeCode === null) {
    state.ws.close()
    return { denied: false, code: null }
  }
  return { denied: state.closeCode === 4403, code: state.closeCode }
}

const results = []
function check(name, ok, detail = '') {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`)
}

const suffix = Date.now().toString().slice(-6)
const ownerUser = `smokeowner${suffix}`
const outsiderUser = `smokeout${suffix}`
const ownerToken = await register(ownerUser)
const outsiderToken = await register(outsiderUser)

// ① owner（合法成员）能连上
//    注意：**不能用新注册的账号去连别人的 design-<id>**——它不是该稿件工作区的成员，网关会（正确地）拒绝。
//    所以脚本自建一份稿件：创建人天然是 owner。
let room = ROOM
if (!args.design) {
  const created = await fetch(`${BACKEND}/api/designs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ownerToken}` },
    body: JSON.stringify({ name: 'gateway-smoke', design: { id: 'root', type: 'frame', children: [] } }),
  })
  if (!created.ok) throw new Error(`创建测试稿件失败：HTTP ${created.status}`)
  room = `design-${(await created.json()).id}`
  console.log(`（未传 --design，已自建测试稿件 room=${room}）`)
}

const a = open(room, ownerToken)
const aState = await a.done
check('合法成员可连接', aState.opened === true, aState.opened ? '' : `close=${aState.closeCode}`)

// ② 无 token / 错 token 被拒
const noToken = await expectDenied(room, '')
check('无 token 被拒（4403）', noToken.denied, `close=${noToken.code}`)
const badToken = await expectDenied(room, 'not-a-jwt')
check('非法 token 被拒（4403）', badToken.denied, `close=${badToken.code}`)

// ③ 非成员被拒
const outsider = await expectDenied(room, outsiderToken)
check('非成员被拒（4403）', outsider.denied, `close=${outsider.code}`)

// ④ viewer 只读：owner 与 viewer 各连一个，viewer 发一条 Yjs update，owner 不应收到
const invite = await fetch(`${BACKEND}/api/workspaces`, { headers: { Authorization: `Bearer ${ownerToken}` } })
const wsList = await invite.json()
const workspaceId = wsList.workspaces?.[0]?.id
let viewerToken = null
if (workspaceId) {
  const inv = await fetch(`${BACKEND}/api/workspaces/${workspaceId}/invites`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ownerToken}` },
    body: JSON.stringify({ role: 'viewer' }),
  })
  if (inv.ok) {
    const viewerUser = `smokeview${suffix}`
    const vt = await register(viewerUser)
    const joined = await fetch(`${BACKEND}/api/workspaces/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${vt}` },
      body: JSON.stringify({ token: (await inv.json()).token }),
    })
    if (joined.ok) viewerToken = vt
  }
}
if (!viewerToken) {
  check('viewer 只读（写消息被丢）', false, '未能准备 viewer 账号（邀请/加入失败），跳过')
} else {
  const ownerClient = await open(room, ownerToken).done
  const viewerClient = await open(room, viewerToken).done
  let ownerSawWrite = false
  // 关键：**只匹配我们发的那条写消息**。上游连上时会立刻发 sync step1（00000100）等管家消息，
  // 旧版"收到任何消息即失败"会把这类正常消息算成写穿透（实测必误判）。
  const marker = Buffer.from([0, 2, 9, 9, 9])
  ownerClient.ws.on('message', (data) => {
    if (Buffer.compare(Buffer.from(data), marker) === 0) ownerSawWrite = true
  })
  viewerClient.ws.send(marker)
  await new Promise((r) => setTimeout(r, 600))
  check('viewer 只读（写消息被丢）', ownerSawWrite === false, ownerSawWrite ? 'owner 收到了 viewer 的写消息' : '')
  ownerClient.ws.close()
  viewerClient.ws.close()
}

aState.ws.close()
const failed = results.filter((r) => !r.ok)
console.log(`\n结果：${results.length - failed.length}/${results.length} 通过`)
process.exit(failed.length ? 1 : 0)
