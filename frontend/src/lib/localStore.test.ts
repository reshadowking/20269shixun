/**
 * 通用本地存储（缺陷 1/3 共用）：损坏数据 / 配额失败 / 无数据都必须安全降级。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

import { loadJson, removeJson, saveJson, scopedKey } from './localStore'

interface Payload {
  id: string
}

const isPayload = (v: unknown): v is Payload =>
  Boolean(v) && typeof v === 'object' && typeof (v as Payload).id === 'string'

describe('localStore', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    localStorage.clear()
  })

  it('scopedKey：有 scope 加后缀，无 scope 用原 key', () => {
    expect(scopedKey('k')).toBe('k')
    expect(scopedKey('k', '3')).toBe('k-3')
  })

  it('save/load 往返；校验不通过返回 null', () => {
    expect(saveJson('k', { id: 'a' })).toBe(true)
    expect(loadJson('k', isPayload)?.id).toBe('a')
    saveJson('k2', { nope: 1 })
    expect(loadJson('k2', isPayload)).toBeNull()
  })

  it('损坏 JSON / 无数据返回 null（不抛错）', () => {
    localStorage.setItem('bad', '{oops')
    expect(loadJson('bad', isPayload)).toBeNull()
    expect(loadJson('missing', isPayload)).toBeNull()
  })

  it('写入失败返回 false（配额/禁用）', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError')
      },
      removeItem: () => {
        throw new Error('blocked')
      },
    })
    expect(saveJson('k', { id: 'a' })).toBe(false)
    expect(loadJson('k', isPayload)).toBeNull()
    expect(() => removeJson('k')).not.toThrow()
  })

  it('removeJson 删除数据', () => {
    saveJson('k', { id: 'a' })
    removeJson('k')
    expect(loadJson('k', isPayload)).toBeNull()
  })
})
