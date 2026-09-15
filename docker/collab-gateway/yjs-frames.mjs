/**
 * T46a-3b：smoke.mjs 用到的 Yjs 协议帧工具。
 *
 * 单独成文件是为了能离线自检 —— `smoke.frames.test.mjs` 会把这里的编码
 * 与 y-protocols/lib0 的官方实现做逐字节比对（网关不在场也能验证帧格式没写错）。
 *
 * Yjs 消息帧：[type, sub, ...varUint8Array(payload)]
 *   type：0=sync、1=awareness、3=queryAwareness…（本文件只用 sync）
 *   sub ：0=step1、1=step2、2=update
 * varUint8Array = varuint(字节长度) + 原始字节（同 lib0 的 writeVarUint8Array）。
 */
import * as Y from 'yjs'

export function varuint(n) {
  const out = []
  while (n > 0x7f) {
    out.push((n & 0x7f) | 0x80)
    n >>= 7
  }
  out.push(n)
  return out
}

/** 组装一条 sync 消息：[0, sub, ...varUint8Array(payload)]。*/
export function frameSync(sub, payload) {
  return Buffer.concat([Buffer.from([0, sub, ...varuint(payload.length)]), Buffer.from(payload)])
}

/**
 * 造一条**真** update：往 doc 里插一段带标记的文本。
 * 只有合法 update 才会被上游 y-websocket 广播；假 payload（例如 `[0,2,9,9,9]`）
 * 会让上游解码抛错、消息根本不扩散，于是"网关漏写"也测不出来。
 */
export function realUpdate(marker) {
  const doc = new Y.Doc()
  doc.getText('t').insert(0, marker)
  return frameSync(2, Y.encodeStateAsUpdate(doc))
}

/** 从收到的帧里解出 sync update 的 payload；不是 update 帧就返回 null。*/
export function updatePayload(buf) {
  if (buf.length < 3 || buf[0] !== 0 || buf[1] !== 2) return null
  let len = 0
  let shift = 0
  let i = 2
  for (;;) {
    if (i >= buf.length) return null
    const b = buf[i++]
    len |= (b & 0x7f) << shift
    if ((b & 0x80) === 0) break
    shift += 7
  }
  return buf.subarray(i, i + len)
}

/**
 * 收到的消息里，有没有哪条 update 的内容包含指定标记。
 * 按**语义**比对（把 update 应用到临时 doc 再读文本），不要求上游字节原样回传。
 */
export function gotUpdateWith(messages, marker) {
  return messages.some((m) => {
    const payload = updatePayload(m)
    if (!payload) return false
    const doc = new Y.Doc()
    try {
      Y.applyUpdate(doc, payload)
    } catch {
      return false
    }
    return doc.getText('t').toString().includes(marker)
  })
}
