/** 「AI 生成后自动转自由画布」偏好（2026-09-17）：**默认开**（用户要的"生成即可拖"），关掉可退回 flex。 */
import { describe, expect, it } from 'vitest'

import { AUTO_FREEZE_KEY, readAutoFreeze, writeAutoFreeze } from './autoFreeze'
import { __setStorageForTests, createMemoryStorage } from './storage'

describe('autoFreeze 偏好', () => {
  it('默认开（没存过 = 开）——这正是"生成即可编辑"的默认行为', () => {
    __setStorageForTests(createMemoryStorage())
    expect(readAutoFreeze()).toBe(true)
    __setStorageForTests(null)
  })

  it('关掉后读回 false（用户可一键退回 flex 模式）', () => {
    __setStorageForTests(createMemoryStorage())
    writeAutoFreeze(false)
    expect(readAutoFreeze()).toBe(false)
    writeAutoFreeze(true)
    expect(readAutoFreeze()).toBe(true)
    __setStorageForTests(null)
  })

  it('非法值（手改过存储）按默认开处理；存储不可用也不崩', () => {
    __setStorageForTests(createMemoryStorage({ [AUTO_FREEZE_KEY]: 'wat' }))
    expect(readAutoFreeze()).toBe(true)
    __setStorageForTests({
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
      removeItem: () => {
        throw new Error('blocked')
      },
    })
    expect(readAutoFreeze()).toBe(true)
    expect(() => writeAutoFreeze(false)).not.toThrow()
    __setStorageForTests(null)
  })
})
