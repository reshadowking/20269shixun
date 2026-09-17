/** 「AI 生成后自动转自由画布」偏好（2026-09-17）：**默认开**（用户要的"生成即可拖"），关掉可退回 flex。 */
import { describe, expect, it } from 'vitest'

import { AUTO_FREEZE_KEY, canAutoFreeze, readAutoFreeze, writeAutoFreeze } from './autoFreeze'
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

/**
 * 守卫必须与「🔓 转自由画布」按钮一致（2026-09-17 修）：
 * 锁定/只读下 `store.convertToFreeLayout()` 会拒绝，此时若还先 pushSnapshot()，
 * 就会留下一个"没有真实改动的撤销步"（撤销按钮亮着、按了没反应）。
 */
describe('canAutoFreeze 守卫', () => {
  it('版面已确认（锁定）→ 不自动冻结', () => {
    expect(canAutoFreeze({ locked: true, readOnly: false, layout: 'column' })).toBe(false)
    expect(canAutoFreeze({ locked: true, readOnly: true, layout: 'column' })).toBe(false)
  })

  it('只读访客 → 不自动冻结', () => {
    expect(canAutoFreeze({ locked: false, readOnly: true, layout: 'column' })).toBe(false)
  })

  it('已是自由画布 → 不重复冻结（幂等）', () => {
    expect(canAutoFreeze({ locked: false, readOnly: false, layout: 'free' })).toBe(false)
  })

  it('普通可编辑的 flex 画布 → 允许（生成即可拖这条主路径不受影响）', () => {
    expect(canAutoFreeze({ locked: false, readOnly: false, layout: 'column' })).toBe(true)
    expect(canAutoFreeze({ locked: false, readOnly: false, layout: undefined })).toBe(true)
    expect(canAutoFreeze({ locked: false, readOnly: false, layout: 'row' })).toBe(true)
  })
})
