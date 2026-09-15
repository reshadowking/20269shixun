/**
 * T46a-3b：协作 WS 鉴权网关冒烟脚本。
 *
 * 覆盖 9 项断言：
 *   (1) 合法成员能连上并**保持**连接（不是"握手成功后再被 4403"）；
 *   (2) 无 token → 4403；
 *   (3) 非法 token → 4403；
 *   (4) 非成员（新注册账号）→ 4403；
 *   (5) 阳性对照 A：owner 的真 Yjs update **必须**到达 viewer（证明链路通、viewer 真在房内）；
 *   (6) 阳性对照 B：viewer 的 sync step1 **必须**拿到上游 step2 应答（证明 viewer 出站消息没被整体吞掉）；
 *   (7) viewer 的真 Yjs update **不得**到达 owner（真·只读）。
 *   (8) 服务端签发的随机房间（`GET /api/designs/{id}/collab`）同样可授权，非成员仍被拒；
 *   (9) viewer 的 sync step2 也**不得**到达 owner（写路径不止 update 一条）。
 *
 * 为什么这么写（前两版"全绿假象"的教训）：
 *   - 只看 `open` 事件判"成员可连接"没用：网关是先完成握手、再 close(4403)，
 *     被拒的连接同样 opened=true → (1) 改成「open 后等 300ms，仍 closeCode===null」。
 *   - 拿 `[0,2,9,9,9]` 当 update 没用：那不是合法 Yjs update，上游解码直接抛错、根本不广播，
 *     网关漏写也测不出来 → (5)(7) 用 `Y.encodeStateAsUpdate` 造**真** update 并按 Yjs 帧封装。
 *   - 没有阳性对照时，「双方压根没连上」会让 (7) 空过（假绿）→ 加 (5)(6)。
 *   - 判定按**语义**比对（把收到的 update 应用到临时 doc，看文本里有没有标记），
 *     不依赖上游是否原样重编码字节。
 *
 * 前置：
 *   1) 后端 :8000，且 backend/.env 配了 COLLAB_INTERNAL_TOKEN（与网关同一个值）；
 *   2) y-websocket 上游 :1234；
 *   3) 网关 :1235：
 *        docker compose --profile collab-auth up -d collab-gateway
 *      或本地直跑：
 *        cd docker/collab-gateway && npm i
 *        PORT=1235 UPSTREAM_WS=ws://localhost:1234 BACKEND_URL=http://localhost:8000 \
 *        JWT_SECRET=<与后端一致> COLLAB_INTERNAL_TOKEN=<同一串> node server.js
 *
 * 用法（在 docker/collab-gateway 目录下）：
 *   npm i
 *   node smoke.mjs                                  # 新注册账号自建一份测试稿件（推荐，无需准备数据）
 *   node smoke.mjs --design 12 --user demo          # 连已有稿件；--user 必须是该稿件所属工作区的成员
 *   node smoke.mjs --design 12 --user demo --password demo123 [--workspace 3]
 *
 * 可选参数：--gateway <ws://host:port>  --backend <http://host:port>  --workspace <id>  --password <pw>
 */
import * as Y from 'yjs'
import { WebSocket } from 'ws'
import { frameSync, gotUpdateWith, realUpdate, realUpdateBytes } from './yjs-frames.mjs'

const args = Object.fromEntries(
  process.argv.slice(2).flatMap((a, i, arr) => (a.startsWith('--') ? [[a.slice(2), arr[i + 1]]] : [])),
)
const GATEWAY = args.gateway || 'ws://localhost:1235'
const BACKEND = args.backend || 'http://localhost:8000'
const DESIGN_ID = args.design
const MEMBER_USER = args.user

if (DESIGN_ID && !MEMBER_USER) {
  console.error('用 --design 连已有稿件时必须同时给 --user <该稿件所属工作区成员账号>：')
  console.error('新注册的账号不是该工作区成员，网关会（正确地）拒绝它，测不出任何东西。')
  console.error('不想准备数据就别传 --design —— 脚本会自己新建一份测试稿件，把新账号当 owner。')
  process.exit(2)
}

// 网关是先完成握手、再异步判权（要打后端）的，所以"连上了"不能只看 open：
// 必须再等一会儿，确认没被 4403 踢掉。800ms 覆盖本机一次后端往返有余。
const ALIVE_WAIT = 800

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const results = []
function check(name, ok, detail = '') {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`)
}

async function api(path, { method = 'GET', token, body } = {}) {
  return fetch(`${BACKEND}${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
}

async function login(username, password) {
  const resp = await api('/api/auth/login', { method: 'POST', body: { username, password } })
  if (!resp.ok) throw new Error(`登录 ${username} 失败：HTTP ${resp.status}`)
  return (await resp.json()).token
}

/** 全新账号：注册即拿到 token；万一已存在，用同一套约定密码登录。 */
async function newAccount(username) {
  const password = `${username}-pw-123`
  const reg = await api('/api/auth/register', { method: 'POST', body: { username, password } })
  if (reg.ok) return (await reg.json()).token
  return login(username, password)
}

// ---------- WebSocket ----------

function open(room, token) {
  const url = `${GATEWAY}/${encodeURIComponent(room)}${token ? `?token=${encodeURIComponent(token)}` : ''}`
  const ws = new WebSocket(url)
  const state = { ws, opened: false, closeCode: null, messages: [] }
  ws.on('message', (data) => state.messages.push(Buffer.from(data)))
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

/** 期望被拒：3s 内必须收到 close，且必须是 4403。*/
async function expectDenied(room, token) {
  const { state } = open(room, token)
  const deadline = Date.now() + 3000
  while (state.closeCode === null && Date.now() < deadline) await sleep(50)
  if (state.closeCode === null) {
    state.ws.close()
    return { denied: false, code: null }
  }
  return { denied: state.closeCode === 4403, code: state.closeCode }
}

// ---------- 准备数据 ----------

const suffix = Date.now().toString(36) + Math.floor(Math.random() * 1000)
const designId = DESIGN_ID ? Number(DESIGN_ID) : null
let room = designId ? `design-${designId}` : ''
let ownerToken
let testDesignId = designId

if (DESIGN_ID) {
  ownerToken = await login(MEMBER_USER, args.password || `${MEMBER_USER}-pw-123`)
  const me = await api(`/api/designs/${DESIGN_ID}/collab`, { token: ownerToken })
  if (!me.ok) throw new Error(`${MEMBER_USER} 看不到 design-${DESIGN_ID}（HTTP ${me.status}）：换该稿件工作区的成员账号（--user）`)
  const { role, can_edit: canEdit } = await me.json()
  if (!canEdit) {
    console.log(`警告：--user ${MEMBER_USER} 在该稿件的角色是 ${role}（只读），脚本需要一个**可写**成员来做阳性对照 A。`)
  } else {
    console.log(`已确认 ${MEMBER_USER} 在 design-${DESIGN_ID} 的角色是 ${role}`)
  }
  if (!args.workspace) {
    console.log('提示：未给 --workspace，脚本自动取该账号 role=owner 的第一个工作区发邀请；')
    console.log('      若该稿件不在那个工作区，viewer 会看不到稿件，阳性对照 A 会失败（属预期，换 --workspace 重试）。')
  }
} else {
  const ownerUser = `smokeowner${suffix}`
  ownerToken = await newAccount(ownerUser)
  const created = await api('/api/designs', {
    method: 'POST',
    token: ownerToken,
    body: { name: 'gateway-smoke', design: { id: 'root', type: 'frame', children: [] } },
  })
  if (!created.ok) throw new Error(`创建测试稿件失败：HTTP ${created.status}`)
  testDesignId = (await created.json()).id
  room = `design-${testDesignId}`
  console.log(`未传 --design：已自建测试稿件 room=${room}（owner=${ownerUser}）`)
}

const outsiderToken = await newAccount(`smokeout${suffix}`)
console.log(`网关 ${GATEWAY} ｜ 后端 ${BACKEND} ｜ 房间 ${room}\n`)

async function firstOwnedWorkspace(token) {
  const resp = await api('/api/workspaces', { token })
  if (!resp.ok) return null
  const list = (await resp.json()).workspaces || []
  const owned = list.find((w) => w.role === 'owner')
  return owned ? owned.id : null
}

/** 准备一个 viewer 账号（owner 发邀请 → viewer 加入）；失败时返回原因，用于把 FAIL 说清楚。*/
async function setUpViewer(token) {
  const workspaceId = args.workspace || (await firstOwnedWorkspace(token))
  if (!workspaceId) {
    return { error: '该账号名下没有 role=owner 的工作区，无法发邀请（连已有稿件时请给 --workspace <稿件所属工作区 id>）' }
  }
  const inv = await api(`/api/workspaces/${workspaceId}/invites`, {
    method: 'POST',
    token,
    body: { role: 'viewer' },
  })
  if (!inv.ok) return { error: `生成 viewer 邀请失败：HTTP ${inv.status}（workspace=${workspaceId}，该账号可能不是它的 owner）` }
  const viewerToken = await newAccount(`smokeview${suffix}`)
  const joined = await api('/api/workspaces/join', {
    method: 'POST',
    token: viewerToken,
    body: { token: (await inv.json()).token },
  })
  if (!joined.ok) return { error: `viewer 加入工作区失败：HTTP ${joined.status}` }
  if (DESIGN_ID) {
    const acc = await api(`/api/designs/${DESIGN_ID}/collab`, { token: viewerToken })
    if (!acc.ok) {
      return { error: `viewer 仍然看不到 design-${DESIGN_ID}（HTTP ${acc.status}）：稿件不在 workspace ${workspaceId}，请用 --workspace 指定稿件所属工作区` }
    }
  }
  return { token: viewerToken }
}

const VIEWER_GAP = '未能准备 viewer 账号，只读结论不可信'
// viewer 相关断言必须成组出现：早退分支里也要把它们全部判红，否则"没连上"会静默少报几项
const [
  CHECK_POSITIVE_A,
  CHECK_POSITIVE_B,
  CHECK_READONLY_UPDATE,
  CHECK_READONLY_STEP2,
] = [
  '阳性对照 A：owner 的 update 到达 viewer',
  '阳性对照 B：viewer 的 sync step1 得到上游 step2 应答',
  'viewer 只读：viewer 的 update 被丢弃',
  'viewer 只读：sync step2（同样携带 update 的写路径）也被丢弃',
]

function failViewerChecks(detail) {
  for (const name of [CHECK_POSITIVE_A, CHECK_POSITIVE_B, CHECK_READONLY_UPDATE, CHECK_READONLY_STEP2]) {
    check(name, false, detail)
  }
}

// ---------- (1) 合法成员可连接且保持连接 ----------

const owner = open(room, ownerToken)
const ownerState = await owner.done
await sleep(ALIVE_WAIT)
const ownerAlive = ownerState.opened && ownerState.closeCode === null
check('合法成员可连接且保持连接', ownerAlive, ownerAlive ? '' : `opened=${ownerState.opened} close=${ownerState.closeCode}`)

// ---------- (2)(3)(4) 越权被拒 ----------

const noToken = await expectDenied(room, '')
check('无 token 被拒（4403）', noToken.denied, `close=${noToken.code}`)
const badToken = await expectDenied(room, 'not-a-jwt')
check('非法 token 被拒（4403）', badToken.denied, `close=${badToken.code}`)
const outsider = await expectDenied(room, outsiderToken)
check('非成员被拒（4403）', outsider.denied, `close=${outsider.code}`)

// ---------- (5)(6)(7) viewer 只读 ----------

const viewerSetup = await setUpViewer(ownerToken)
if (viewerSetup.error) {
  console.log(`\n${VIEWER_GAP}：${viewerSetup.error}`)
  failViewerChecks(VIEWER_GAP)
} else {
  const viewerState = await open(room, viewerSetup.token).done
  await sleep(ALIVE_WAIT)
  if (!(viewerState.opened && viewerState.closeCode === null)) {
    failViewerChecks(`viewer 未能连上：opened=${viewerState.opened} close=${viewerState.closeCode}`)
  } else {
    const ownerMarker = `frm-owner-${suffix}`
    const viewerMarker = `frm-viewer-${suffix}`

    // (5) 阳性对照 A：owner（可写）发真 update → viewer 必须收到。
    ownerState.ws.send(realUpdate(ownerMarker))
    await sleep(600)
    const viewerSawOwner = gotUpdateWith(viewerState.messages, ownerMarker)
    check(
      CHECK_POSITIVE_A,
      viewerSawOwner,
      viewerSawOwner ? '' : 'owner→viewer 链路不通，下面的只读结论不可信',
    )

    // (6) 阳性对照 B：viewer 发 sync step1（协议规定必须放行）→ 上游必须回 step2。
    //     证明 viewer 的出站消息没有被网关"整体静音"，只读是选择性丢弃写消息。
    viewerState.messages.length = 0
    viewerState.ws.send(frameSync(0, Y.encodeStateVector(new Y.Doc())))
    await sleep(600)
    const viewerGotStep2 = viewerState.messages.some((m) => m.length >= 2 && m[0] === 0 && m[1] === 1)
    check(CHECK_POSITIVE_B, viewerGotStep2, viewerGotStep2 ? '' : 'viewer 出站消息疑似被整体吞掉')

    // (7) 关键断言：viewer 发真 update → owner 不得收到。
    ownerState.messages.length = 0
    viewerState.ws.send(realUpdate(viewerMarker))
    await sleep(600)
    const ownerSawViewer = gotUpdateWith(ownerState.messages, viewerMarker)
    check(CHECK_READONLY_UPDATE, !ownerSawViewer, ownerSawViewer ? 'owner 收到了 viewer 的写消息（网关漏写）' : '')

    // (7b) 写路径不止 sync update：sync step2 同样携带 update（上游会 apply 后广播给其他人）。
    //      只固定 update 一条路径的话，以后改 isWriteMessage 会静默退化。
    ownerState.messages.length = 0
    viewerState.ws.send(frameSync(1, realUpdateBytes(`${viewerMarker}-step2`)))
    await sleep(600)
    const ownerSawStep2 = gotUpdateWith(ownerState.messages, `${viewerMarker}-step2`)
    check(CHECK_READONLY_STEP2, !ownerSawStep2, ownerSawStep2 ? 'owner 收到了 viewer 的 step2 写消息' : '')

    viewerState.ws.close()
  }
}

// ---------- (8) 服务端签发的随机房间 ----------
// 前面的 (1)(7) 用的是 `design-<id>`（当前前端就是这么派生的，网关为此留了兼容分支）。
// 本卡 §七 要求"房间名不可猜、由服务端签发"，这里把签发出来的那个 room 也真连一次。

const collab = await api(`/api/designs/${testDesignId}/collab`, { token: ownerToken })
if (!collab.ok) {
  check('服务端签发的随机房间可授权（非成员仍被拒）', false, `GET /api/designs/${testDesignId}/collab → HTTP ${collab.status}`)
} else {
  const signedRoom = (await collab.json()).room
  const signedState = await open(signedRoom, ownerToken).done
  await sleep(ALIVE_WAIT)
  const signedAlive = signedState.opened && signedState.closeCode === null
  signedState.ws.close()
  const signedOutsider = await expectDenied(signedRoom, outsiderToken)
  check(
    '服务端签发的随机房间可授权（非成员仍被拒）',
    signedAlive && signedOutsider.denied,
    signedAlive ? `非成员 close=${signedOutsider.code}` : `room=${signedRoom} opened=${signedState.opened} close=${signedState.closeCode}`,
  )
}

ownerState.ws.close()

const failed = results.filter((r) => !r.ok)
console.log(`\n结果：${results.length - failed.length}/${results.length} 通过`)
process.exit(failed.length ? 1 : 0)
