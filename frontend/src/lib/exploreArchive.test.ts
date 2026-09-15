/**
 * 方案留档（缺陷 1）：localStorage 读写、scope 隔离、脏数据与配额失败时的降级。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  clearExploreArchive,
  exploreArchiveKey,
  loadExploreArchive,
  saveExploreArchive,
  type ExploreArchive,
} from './exploreArchive'
import type { DesignNode } from '@/design/types'

const DESIGN: DesignNode = { id: 'root', type: 'frame', children: [{ id: 't', type: 'text', props: { text: '标题' } }] }

function archive(overrides: Partial<ExploreArchive> = {}): ExploreArchive {
  return {
    options: [
      { label: '方案一 · 默认风格', design: DESIGN, template: 'login', compliance: 92, violations: 0 },
      { label: '方案二 · 差异化风格', design: DESIGN, template: 'dashboard', compliance: 100, violations: 0, fallback: true },
    ],
    degraded: true,
    chosenIndex: 0,
    at: 1700000000000,
    ...overrides,
  }
}

describe('exploreArchive', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    localStorage.clear()
  })

  it('key：按 scope 分片，无 scope 用全局 key', () => {
    expect(exploreArchiveKey()).toBe('design-explore-archive')
    expect(exploreArchiveKey('12')).toBe('design-explore-archive-12')
  })

  it('save/load 往返：保留两套详情与选定下标，并由存储层打时间戳', () => {
    expect(saveExploreArchive(undefined, archive())).toBe(true)
    const loaded = loadExploreArchive()
    expect(loaded?.chosenIndex).toBe(0)
    expect(loaded?.options).toHaveLength(2)
    expect(loaded?.options[1].fallback).toBe(true)
    expect(loaded?.options[1].template).toBe('dashboard')
    expect(loaded?.at).toBeGreaterThan(0)
  })

  it('scope 隔离：design-A 的留档不会出现在 design-B', () => {
    saveExploreArchive('A', archive({ chosenIndex: 1 }))
    expect(loadExploreArchive('A')?.chosenIndex).toBe(1)
    expect(loadExploreArchive('B')).toBeNull()
  })

  it('脏数据/越界下标：视为无留档（不抛错）', () => {
    localStorage.setItem(exploreArchiveKey(), '{ not json')
    expect(loadExploreArchive()).toBeNull()
    localStorage.setItem(exploreArchiveKey(), JSON.stringify(archive({ chosenIndex: 5 })))
    expect(loadExploreArchive()).toBeNull()
    localStorage.setItem(exploreArchiveKey(), JSON.stringify({ options: [] }))
    expect(loadExploreArchive()).toBeNull()
  })

  it('写入失败（配额/禁用）返回 false 且不残留半截数据', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError')
      },
      removeItem: () => {},
    })
    expect(saveExploreArchive(undefined, archive())).toBe(false)
    expect(loadExploreArchive()).toBeNull()
  })

  it('clear：清掉对应 scope 的留档', () => {
    saveExploreArchive('A', archive())
    clearExploreArchive('A')
    expect(loadExploreArchive('A')).toBeNull()
  })
})
