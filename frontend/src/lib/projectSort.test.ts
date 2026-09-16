/** 排序记忆（2026-09-16）：默认值 / 往返 / 非法值回落 / 存储不可用不崩。 */
import { describe, expect, it } from 'vitest'

import { DEFAULT_PROJECT_SORT, PROJECT_SORT_KEY, isProjectSort, readProjectSort, writeProjectSort } from './projectSort'
import { __setStorageForTests, createMemoryStorage } from './storage'

describe('projectSort', () => {
  it('默认"最近修改"；写入后能读回', () => {
    __setStorageForTests(createMemoryStorage())
    expect(readProjectSort()).toBe(DEFAULT_PROJECT_SORT)
    writeProjectSort('name_asc')
    expect(readProjectSort()).toBe('name_asc')
    __setStorageForTests(null)
  })

  it('非法值回落默认（手改过存储也不能把页面搞坏）', () => {
    __setStorageForTests(createMemoryStorage({ [PROJECT_SORT_KEY]: 'owner_id' }))
    expect(readProjectSort()).toBe(DEFAULT_PROJECT_SORT)
    expect(isProjectSort('owner_id')).toBe(false)
    expect(isProjectSort('created_desc')).toBe(true)
    __setStorageForTests(null)
  })

  it('存储抛错时不崩（隐私模式/配额满）', () => {
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
    expect(readProjectSort()).toBe(DEFAULT_PROJECT_SORT)
    expect(() => writeProjectSort('updated_asc')).not.toThrow()
    __setStorageForTests(null)
  })
})
