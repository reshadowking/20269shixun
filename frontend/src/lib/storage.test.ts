/** T41：存储适配器（默认走浏览器存储；注入后端后不再碰 window；异常时安全降级）。 */
import { afterEach, describe, expect, it } from 'vitest'

import {
  __setStorageForTests,
  createMemoryStorage,
  readStorage,
  removeStorage,
  writeStorage,
  type StorageLike,
} from './storage'

describe('storage 适配器', () => {
  afterEach(() => {
    __setStorageForTests(null)
  })

  it('默认写入浏览器 localStorage', () => {
    __setStorageForTests(null)
    expect(writeStorage('k', 'v')).toBe(true)
    expect(window.localStorage.getItem('k')).toBe('v')
    expect(readStorage('k')).toBe('v')
    removeStorage('k')
    expect(window.localStorage.getItem('k')).toBeNull()
  })

  it('注入后端后不再触碰 window.localStorage', () => {
    const injected = createMemoryStorage()
    __setStorageForTests(injected)
    writeStorage('theme', 'dark')
    expect(readStorage('theme')).toBe('dark')
    expect(window.localStorage.getItem('theme')).toBeNull() // 关键：window 没被写
  })

  it('写入失败（配额/禁用）返回 false 且不抛错', () => {
    const failing: StorageLike = {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota exceeded')
      },
      removeItem: () => undefined,
    }
    __setStorageForTests(failing)
    expect(writeStorage('k', 'v')).toBe(false)
    expect(readStorage('k')).toBeNull()
  })
})
