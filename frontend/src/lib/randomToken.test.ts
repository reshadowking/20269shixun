/**
 * 随机凭证生成（2026-09-17）：草稿房间名就是共享凭证，必须走 CSPRNG。
 * 用 Math.random 时它是可预测/可回推的——"猜中就能进别人的未保存画布"。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

import { randomRoom } from './collabRoom'
import { randomToken } from './randomToken'
import { randomSessionKey } from './sessionKey'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('randomToken', () => {
  it('长度与字符集：只含 [a-z0-9]，长度精确', () => {
    for (const len of [1, 8, 16, 33]) {
      const token = randomToken(len)
      expect(token).toHaveLength(len)
      expect(token).toMatch(/^[a-z0-9]+$/)
    }
  })

  it('200 次不重复（8 位 base36 ≈ 41 bit，碰撞概率可忽略）', () => {
    const seen = new Set(Array.from({ length: 200 }, () => randomToken(8)))
    expect(seen.size).toBe(200)
  })

  it('走 CSPRNG：crypto.getRandomValues 被调用，且输出由它给的字节决定', () => {
    const spy = vi.fn((arr: Uint8Array) => {
      arr.fill(0) // 全 0 → 全 'a'
      return arr
    })
    vi.stubGlobal('crypto', { getRandomValues: spy })
    expect(randomToken(8)).toBe('aaaaaaaa')
    expect(spy).toHaveBeenCalled()
  })

  it('拒绝采样：>=252 的字节被丢弃重摇（消除取模偏置），结果仍是合法字符', () => {
    let call = 0
    vi.stubGlobal('crypto', {
      getRandomValues: (arr: Uint8Array) => {
        // 前两次都给"必须丢弃"的字节，第三次给合法值
        call += 1
        if (call <= 2) arr.fill(255)
        else arr.fill(3)
        return arr
      },
    })
    expect(randomToken(4)).toBe('dddd') // 3 % 36 = 3 → 字母表第 4 个
    expect(call).toBeGreaterThan(2)
  })

  it('没有 Web Crypto 时退回 Math.random，仍保证长度与字符集（不崩）', () => {
    vi.stubGlobal('crypto', undefined)
    const token = randomToken(12)
    expect(token).toHaveLength(12)
    expect(token).toMatch(/^[a-z0-9]+$/)
  })
})

describe('会话 key / 房间名沿用新随机源（形状不变）', () => {
  it('randomSessionKey 仍是 s- + 8 位 base36（URL 与后端白名单依赖这个形状）', () => {
    expect(randomSessionKey()).toMatch(/^s-[a-z0-9]{8}$/)
  })

  it('randomRoom 仍是 local- + 8 位 base36', () => {
    expect(randomRoom()).toMatch(/^local-[a-z0-9]{8}$/)
  })
})
