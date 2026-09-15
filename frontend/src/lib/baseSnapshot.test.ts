/**
 * 基础版快照与通用存储层（缺陷 3 + 复用缺陷 1 的 localStore）。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

import { baseSnapshotKey, clearBaseSnapshot, loadBaseSnapshot, saveBaseSnapshot } from './baseSnapshot'
import type { DesignNode } from '@/design/types'

const DESIGN: DesignNode = {
  id: 'root',
  type: 'frame',
  style: { layout: 'column', background: '#F5F5F5' },
  children: [{ id: 'c1', type: 'component', componentType: 'card', props: { title: '卡片' }, style: { width: 320 } }],
}

describe('baseSnapshot（缺陷 3 基础版快照）', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    localStorage.clear()
  })

  it('key 按 scope 分片', () => {
    expect(baseSnapshotKey()).toBe('design-base-snapshot')
    expect(baseSnapshotKey('7')).toBe('design-base-snapshot-7')
  })

  it('保存后再改原树，快照不受影响（深拷贝隔离）', () => {
    saveBaseSnapshot(undefined, DESIGN)
    DESIGN.children![0].style!.width = 999
    DESIGN.style!.background = '#000000'
    const snap = loadBaseSnapshot()
    expect(snap?.design.children?.[0].style?.width).toBe(320)
    expect(snap?.design.style?.background).toBe('#F5F5F5')
    expect(snap?.at).toBeGreaterThan(0)
  })

  it('scope 隔离：另一个设计会话读不到本会话快照', () => {
    saveBaseSnapshot('A', DESIGN)
    expect(loadBaseSnapshot('A')?.design.id).toBe('root')
    expect(loadBaseSnapshot('B')).toBeNull()
  })

  it('脏数据/缺字段视为无快照', () => {
    localStorage.setItem(baseSnapshotKey(), '{ not json')
    expect(loadBaseSnapshot()).toBeNull()
    localStorage.setItem(baseSnapshotKey(), JSON.stringify({ design: { type: 'frame' } }))
    expect(loadBaseSnapshot()).toBeNull()
  })

  it('写入失败（配额）返回 false，不抛错', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError')
      },
      removeItem: () => {},
    })
    expect(saveBaseSnapshot(undefined, DESIGN)).toBe(false)
    expect(loadBaseSnapshot()).toBeNull()
  })

  it('clear 清掉快照', () => {
    saveBaseSnapshot('A', DESIGN)
    clearBaseSnapshot('A')
    expect(loadBaseSnapshot('A')).toBeNull()
  })
})
