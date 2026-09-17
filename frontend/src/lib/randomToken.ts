/**
 * 随机标识 / 凭证生成（2026-09-17）。
 *
 * 为什么不能再用 `Math.random()`：这里的产物不只是"内部 id"。
 * `randomSessionKey()` 派生的 `session-s-xxxxxxxx` 同时是**草稿协作房间名**——
 * 过协作网关时"房间名当共享凭证"（`backend/app/routers/collab.py` 对非稿件房间的判定），
 * 也就是一张 bearer 凭证：猜中就能进别人的未保存画布读/写。
 * `Math.random()` 是可预测、可回推的非密码学 PRNG，凭证类随机数必须用 CSPRNG。
 *
 * 字符集与长度**保持与原实现一致**（base36 小写、调用方指定位数），
 * 因此 URL 语义、`isRandomSessionKey` 的形状断言都不变。
 */
const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789' // 36 个字符 = 旧版 toString(36) 的字符集
const REJECT_FROM = 252 // floor(256 / 36) * 36，超过就拿掉重摇（拒绝采样，避免取模偏置）

/** 取 `length` 个随机字节（默认 CSPRNG；无 Web Crypto 时退回 Math.random） */
function randomBytes(length: number): Uint8Array {
  // 用显式 ArrayBuffer 构造：TS 里 Uint8Array<ArrayBuffer> 才满足 getRandomValues 的入参类型
  const bytes = new Uint8Array(new ArrayBuffer(length))
  const cryptoObj = globalThis.crypto
  if (cryptoObj && typeof cryptoObj.getRandomValues === 'function') {
    cryptoObj.getRandomValues(bytes)
    return bytes
  }
  // 无 Web Crypto（极老环境 / 特殊测试环境）：退回 Math.random，保证功能可用
  for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256)
  return bytes
}

/** 生成 `length` 位 [a-z0-9] 随机串（默认走 CSPRNG）。 */
export function randomToken(length: number): string {
  let out = ''
  while (out.length < length) {
    for (const byte of randomBytes(length - out.length)) {
      if (byte >= REJECT_FROM) continue
      out += ALPHABET[byte % ALPHABET.length]
      if (out.length === length) break
    }
  }
  return out
}
