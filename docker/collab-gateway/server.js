/**
 * T46a-3：y-websocket 鉴权网关（方案 A）。
 *
 * 职责：接管对外 WS 端口（默认 1235），在建立连接前校验：
 *   ① JWT（与后端同密钥 HS256，载荷 sub=username、exp）；
 *   ② 房间成员资格（调后端 POST /api/collab/authorize，带内网令牌）；
 * 通过后再转发到内部 y-websocket；**viewer 角色的写消息被丢弃**（真·只读）。
 *
 * 未通过 → close(4403)，前端据此提示"无权进入该协作房间"（不静默重连）。
 *
 * ⚠️ 本文件**未经容器实测**（开发环境无法启动 Docker）：首次启用请按
 * docs/T46a-3-WS鉴权代理-任务卡.md §四 的双浏览器清单逐条验证，
 * 尤其是"Yjs 协议消息白名单"是否正确（sync step1/awareness 必须放行）。
 */
const crypto = require('crypto')
const http = require('http')
const { URL } = require('url')
const { WebSocket, WebSocketServer } = require('ws')

const PORT = Number(process.env.PORT || 1235)
const UPSTREAM_WS = process.env.UPSTREAM_WS || 'ws://y-websocket:1234'
const BACKEND_URL = process.env.BACKEND_URL || 'http://backend:8000'
const INTERNAL_TOKEN = process.env.COLLAB_INTERNAL_TOKEN || ''
const JWT_SECRET = process.env.JWT_SECRET || ''

/** HS256 验签（只做这一种算法；与后端 security.create_token 同格式）。 */
function verifyJwt(token) {
  if (!JWT_SECRET || !token) return null
  const parts = token.split('.')
  if (parts.length !== 3) return null
  const [header, payload, signature] = parts
  const expected = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${payload}`).digest('base64url')
  const a = Buffer.from(expected)
  const b = Buffer.from(signature)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
    if (claims.exp && Date.now() / 1000 > claims.exp) return null
    return typeof claims.sub === 'string' ? claims.sub : null
  } catch {
    return null
  }
}

async function authorize(room, username) {
  const resp = await fetch(`${BACKEND_URL}/api/collab/authorize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Internal-Token': INTERNAL_TOKEN },
    body: JSON.stringify({ room, username }),
  })
  if (!resp.ok) return { ok: false, role: null }
  return resp.json()
}

/**
 * viewer 只读：丢弃"客户端 → 上游"的写消息。
 * Yjs 消息首字节为类型：0=sync（第二字节 0=step1、1=step2、2=update）、1=awareness、3=queryAwareness。
 * 只放行 sync step1 与 awareness 相关，其余（step2 / update）一律丢弃。
 */
function isWriteMessage(buf) {
  if (!buf || buf.length < 2) return false
  const type = buf[0]
  const sub = buf[1]
  if (type === 0) return !(sub === 0) // sync：只放行 step1
  return false // awareness(1) / query(3) / stateless 放行
}

const server = http.createServer((req, res) => {
  if (req.url === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true, upstream: UPSTREAM_WS, auth: Boolean(JWT_SECRET && INTERNAL_TOKEN) }))
    return
  }
  res.writeHead(404)
  res.end()
})

const wss = new WebSocketServer({ server })

wss.on('connection', async (client, req) => {
  const url = new URL(req.url, 'http://localhost')
  const room = decodeURIComponent(url.pathname.replace(/^\//, '')) || 'design-room'
  const username = verifyJwt(url.searchParams.get('token') || '')
  if (!username) {
    client.close(4403, 'unauthorized')
    return
  }

  let verdict = { ok: false, role: null }
  try {
    verdict = await authorize(room, username)
  } catch (err) {
    console.error('[gateway] authorize 调用失败：', err.message)
  }
  if (!verdict.ok) {
    client.close(4403, 'forbidden')
    return
  }

  const upstream = new WebSocket(`${UPSTREAM_WS}/${encodeURIComponent(room)}`)
  const readOnly = verdict.role === 'viewer'
  console.log(`[gateway] ${username} 进入 room=${room} role=${verdict.role}${readOnly ? '（只读）' : ''}`)

  upstream.on('message', (data, isBinary) => {
    if (client.readyState === WebSocket.OPEN) client.send(data, { binary: isBinary })
  })
  client.on('message', (data, isBinary) => {
    if (readOnly && isBinary && isWriteMessage(data)) return // viewer：丢弃写消息
    if (upstream.readyState === WebSocket.OPEN) upstream.send(data, { binary: isBinary })
  })
  const close = () => {
    if (client.readyState === WebSocket.OPEN) client.close(1000)
    if (upstream.readyState === WebSocket.OPEN) upstream.close(1000)
  }
  upstream.on('close', close)
  client.on('close', close)
  upstream.on('error', (err) => console.error('[gateway] upstream 错误：', err.message))
})

server.listen(PORT, () => {
  console.log(`[gateway] listening on :${PORT} → ${UPSTREAM_WS}（auth=${Boolean(JWT_SECRET && INTERNAL_TOKEN)}）`)
})
