/** T45：资产库展示方式的记忆（默认值 / 往返 / 非法值回落）。 */
import { describe, expect, it } from 'vitest'

import { ASSET_VIEW_KEY, DEFAULT_ASSET_VIEW, isAssetView, readAssetView, writeAssetView } from './assetView'
import { __setStorageForTests, createMemoryStorage } from './storage'

describe('assetView', () => {
  it('默认是大图标；写入后能读回', () => {
    __setStorageForTests(createMemoryStorage())
    expect(readAssetView()).toBe(DEFAULT_ASSET_VIEW)
    writeAssetView('details')
    expect(readAssetView()).toBe('details')
    __setStorageForTests(null)
  })

  it('非法值回落默认（手改过 localStorage 也不能把页面搞坏）', () => {
    __setStorageForTests(createMemoryStorage({ [ASSET_VIEW_KEY]: 'wat' }))
    expect(readAssetView()).toBe(DEFAULT_ASSET_VIEW)
    expect(isAssetView('wat')).toBe(false)
    expect(isAssetView('small')).toBe(true)
    __setStorageForTests(null)
  })

  it('存储不可用时不抛错（隐私模式/配额满）', () => {
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
    expect(readAssetView()).toBe(DEFAULT_ASSET_VIEW)
    expect(() => writeAssetView('tiles')).not.toThrow()
    __setStorageForTests(null)
  })
})
