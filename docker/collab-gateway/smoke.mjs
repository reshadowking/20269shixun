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

/** 打开一个 WS，返回 { ws, closeCode }；resolve 时表示已连接（或已关闭）。 */
function open(room, token) {
  const url = `${GATEWAY}/${encodeURIComponent(room)}${token ? `?token=${encodeURIComponent(token)}` : ''}`
  const ws = new WebSocket(url)
  const state = { ws, closeCode: null, opened: false }
  const done = new Promise((resolve) => {
    ws.on('open', () => {
      state.opened = true
      resolve(state)
    })
    ws.on('close', (code) => {
      state.closeCode = code
      resolve(state)
    })
    ws.on('error', () => resolve(state))
  })
  return { state, done }
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
const a = open(ROOM, ownerToken)
const aState = await a.done
check('合法成员可连接', aState.opened === true, aState.opened ? '' : `close=${aState.closeCode}`)

// ② 无 token / 错 token 被拒
const noToken = await open(ROOM, '').done
check('无 token 被拒（4403）', noToken.closeCode === 4403, `close=${noToken.closeCode}`)
const badToken = await open(ROOM, 'not-a-jwt').done
check('非法 token 被拒（4403）', badToken.closeCode === 4403, `close=${badToken.closeCode}`)

// ③ 非成员被拒
const outsider = await open(ROOM, outsiderToken).done
check('非成员被拒（4403）', outsider.closeCode === 4403, `close=${outsider.closeCode}`)

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
  const ownerClient = await open(ROOM, ownerToken).done
  const viewerClient = await open(ROOM, viewerToken).done
  let ownerSawWrite = false
  ownerClient.ws.on('message', () => {
    ownerSawWrite = true
  })
  // 一条最小 Yjs update 消息：类型 0（sync）子类型 2（update）+ 空载荷（内容不重要，关键看是否被转发）
  const fakeUpdate = Buffer.from([0, 2, 1])
  viewerClient.ws.send(fakeUpdate)
  await new Promise((r) => setTimeout(r, 600))
  check('viewer 只读（写消息被丢）', ownerSawWrite === false, ownerSawWrite ? 'owner 收到了 viewer 的写消息' : '')
  ownerClient.ws.close()
  viewerClient.ws.close()
}

aState.ws.close()
const failed = results.filter((r) => !r.ok)
console.log(`\n结果：${results.length - failed.length}/${results.length} 通过`)
process.exit(failed.length ? 1 : 0)
