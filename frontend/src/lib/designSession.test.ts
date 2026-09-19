/**
 * 草稿本地持久化（2026-09-17 首次给这个模块补测试）：
 * ① 往返：saveDraft → loadDraft 原样读回；② 按 sessionKey 分片互不覆盖；
 * ③ **写入失败要能上报**（配额满/被禁用时不再静默丢草稿）。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { DesignNode } from '@/design/types'

import { draftKey, loadDraft, loadLatestDraft, saveDraft } from './designSession'

function tree(text: string): DesignNode {
  return {
    id: 'root',
    type: 'frame',
    style: { layout: 'column' },
    children: [{ id: 't', type: 'text', props: { text } }],
  }
}

afterEach(() => {
  // 顺序要紧：先还原 stub，再清理真实 localStorage
  // （草稿写的是真实 localStorage，不清理会污染其它用例，比如首页的 hasDraft）
  vi.unstubAllGlobals()
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('designSession 草稿', () => {
  it('saveDraft → loadDraft 原样读回（含 meta 合并与 updatedAt）', () => {
    expect(saveDraft('s-1', tree('第一版'), { savedId: 7, savedName: '稿子' })).toBe(true)
    const draft = loadDraft('s-1')
    expect(draft?.design.children?.[0].props?.text).toBe('第一版')
    expect(draft?.meta.savedId).toBe(7)
    expect(draft?.meta.savedName).toBe('稿子')

    // 不传 meta 时沿用上一次的 savedId/savedName（旧行为）
    saveDraft('s-1', tree('第二版'))
    const again = loadDraft('s-1')
    expect(again?.design.children?.[0].props?.text).toBe('第二版')
    expect(again?.meta.savedId).toBe(7)
  })

  it('按 sessionKey 分片：两个会话互不覆盖', () => {
    saveDraft('s-a', tree('A 的稿'))
    saveDraft('s-b', tree('B 的稿'))
    expect(loadDraft('s-a')?.design.children?.[0].props?.text).toBe('A 的稿')
    expect(loadDraft('s-b')?.design.children?.[0].props?.text).toBe('B 的稿')
    expect(draftKey('s-a')).not.toBe(draftKey('s-b'))
  })

  it('写入失败要上报 false（配额满/被禁用不再是静默丢草稿）', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError')
      },
      removeItem: () => {},
      clear: () => {},
      key: () => null,
      length: 0,
    })
    expect(saveDraft('s-1', tree('写不进去'))).toBe(false)
    expect(loadDraft('s-1')).toBeNull() // 读不到但仍不崩
  })

  it('loadLatestDraft：取 updatedAt 最新的一份（含旧全局键）', () => {
    saveDraft('s-old', tree('旧的'))
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 1000)
    saveDraft('s-new', tree('新的'))
    const latest = loadLatestDraft()
    expect(latest?.sessionKey).toBe('s-new')
    expect(latest?.draft.design.children?.[0].props?.text).toBe('新的')
  })
})
