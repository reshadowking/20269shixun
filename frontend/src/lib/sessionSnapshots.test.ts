/**
 * 会话快照（缺陷 4b）：保存/列表/上限淘汰/删除/按会话隔离/深拷贝隔离。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  MAX_SESSION_SNAPSHOTS,
  clearSnapshots,
  deleteSnapshot,
  loadSnapshots,
  saveSnapshot,
  snapshotsKey,
} from './sessionSnapshots'
import type { DesignNode } from '@/design/types'

function tree(marker: string): DesignNode {
  return { id: 'root', type: 'frame', style: { layout: 'column' }, children: [{ id: `t-${marker}`, type: 'text', props: { text: marker } }] }
}

describe('sessionSnapshots（缺陷 4b）', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    localStorage.clear()
  })

  it('保存后可按会话读回（最新在前）', () => {
    saveSnapshot('s-a', tree('第一版'), '初稿')
    const list = saveSnapshot('s-a', tree('第二版'), '改配色')
    expect(list).toHaveLength(2)
    expect(list[0].label).toBe('改配色')
    expect(list[1].label).toBe('初稿')
    expect(loadSnapshots('s-a')).toHaveLength(2)
  })

  it('深拷贝隔离：保存后再改原树，快照不受影响', () => {
    const design = tree('原始')
    saveSnapshot('s-a', design)
    design.children![0].props!.text = '被改了'
    expect(loadSnapshots('s-a')[0].design.children?.[0].props?.text).toBe('原始')
  })

  it('上限淘汰：超过 10 条丢最旧的', () => {
    for (let i = 0; i < MAX_SESSION_SNAPSHOTS + 3; i += 1) {
      saveSnapshot('s-a', tree(`v${i}`), `第 ${i} 次`)
    }
    const list = loadSnapshots('s-a')
    expect(list).toHaveLength(MAX_SESSION_SNAPSHOTS)
    expect(list[0].label).toBe(`第 ${MAX_SESSION_SNAPSHOTS + 2} 次`)
    expect(list.some((s) => s.label === '第 0 次')).toBe(false)
  })

  it('按会话隔离：A 的快照在 B 看不到，键也不互相覆盖', () => {
    saveSnapshot('s-a', tree('A 的'))
    saveSnapshot('s-b', tree('B 的'))
    expect(loadSnapshots('s-a')[0].design.children?.[0].props?.text).toBe('A 的')
    expect(loadSnapshots('s-b')[0].design.children?.[0].props?.text).toBe('B 的')
    expect(snapshotsKey('s-a')).not.toBe(snapshotsKey('s-b'))
  })

  it('删除单条 / 清空会话快照', () => {
    const list = saveSnapshot('s-a', tree('x'), '待删')
    const after = deleteSnapshot('s-a', list[0].id)
    expect(after).toHaveLength(0)
    saveSnapshot('s-a', tree('y'))
    clearSnapshots('s-a')
    expect(loadSnapshots('s-a')).toHaveLength(0)
  })

  it('损坏数据视为无快照；写入失败不抛错', () => {
    localStorage.setItem(snapshotsKey('s-a'), '{bad json')
    expect(loadSnapshots('s-a')).toEqual([])
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError')
      },
      removeItem: () => {},
    })
    expect(() => saveSnapshot('s-a', tree('x'))).not.toThrow()
  })
})
