/**
 * 老数据迁移（缺陷 4）：归属映射正确、幂等、失败可重试、不丢数据。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { exploreArchiveKey } from './exploreArchive'
import { baseSnapshotKey } from './baseSnapshot'
import { loadDraft } from './designSession'
import { MIGRATION_MARKER, ORPHAN_SESSION_KEY, hasLegacyData, migrateLegacySessions } from './migrateLegacySessions'
import { loadJson } from './localStore'
import { sessionApi } from './sessionApi'
import type { DesignNode } from '@/design/types'

const DESIGN: DesignNode = { id: 'root', type: 'frame', children: [{ id: 't', type: 'text', props: { text: '内容' } }] }

function seedLegacyGlobal() {
  localStorage.setItem('design-chat-history', JSON.stringify([{ role: 'user', text: '老朋友的问题' }]))
  localStorage.setItem('design-draft', JSON.stringify({ design: DESIGN, meta: { savedId: 7, updatedAt: 111 } }))
  localStorage.setItem('design-explore-archive', JSON.stringify({ options: [{ label: '方案一', design: DESIGN, template: 'login', compliance: 100, violations: 0 }], degraded: false, chosenIndex: 0 }))
  localStorage.setItem('design-base-snapshot', JSON.stringify({ design: DESIGN, at: 5 }))
  // 按设计分片的历史
  localStorage.setItem('design-chat-history-9', JSON.stringify([{ role: 'user', text: '设计 9 的历史' }]))
}

describe('migrateLegacySessions（缺陷 4 老数据迁移）', () => {
  let appendCalls: Array<{ key: string; texts: string[] }>

  beforeEach(() => {
    localStorage.clear()
    appendCalls = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, options?: RequestInit) => {
      const path = String(url)
      const key = path.split('/api/sessions/')[1]?.split('/')[0] ?? ''
      if (path.includes('/messages') && options?.method === 'POST') {
        const body = JSON.parse(String(options.body ?? '{}')) as { messages?: Array<{ text: string }> }
        appendCalls.push({ key, texts: (body.messages ?? []).map((m) => m.text) })
        return { ok: true, status: 200, json: async () => ({ session_id: key, pruned: 0 }) }
      }
      return { ok: true, status: 200, json: async () => ({ session_id: key, created: true, title: 't', design_id: null, created_at: null, updated_at: null }) }
    }))
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    localStorage.clear()
  })

  it('无老数据：直接落标记，不做任何上传', async () => {
    const report = await migrateLegacySessions()
    expect(report.sessions).toEqual([])
    expect(appendCalls).toEqual([])
    expect(localStorage.getItem(MIGRATION_MARKER)).toBe('1')
  })

  it('全局历史按草稿的 savedId 归属 s-design-{id}；按设计分片的历史各归其主', async () => {
    seedLegacyGlobal()
    expect(hasLegacyData()).toBe(true)
    const report = await migrateLegacySessions()

    expect(report.ran).toBe(true)
    expect(report.messages).toBe(2)
    const byKey = Object.fromEntries(appendCalls.map((c) => [c.key, c.texts]))
    expect(byKey['s-design-7']).toEqual(['老朋友的问题'])
    expect(byKey['s-design-9']).toEqual(['设计 9 的历史'])
    expect(localStorage.getItem(MIGRATION_MARKER)).toBe('1')
  })

  it('本地数据搬家：留档/基础版/草稿改挂会话键（旧键清掉，不占双份配额）', async () => {
    seedLegacyGlobal()
    await migrateLegacySessions()

    expect(localStorage.getItem(exploreArchiveKey('s-design-7'))).toBeTruthy()
    expect(localStorage.getItem(baseSnapshotKey('s-design-7'))).toBeTruthy()
    expect(loadDraft('s-design-7')?.design.id).toBe('root')
    // 旧键已搬走（避免大对象双份占配额），新键内容完好
    expect(localStorage.getItem('design-explore-archive')).toBeNull()
    expect(localStorage.getItem('design-base-snapshot')).toBeNull()
    expect(localStorage.getItem('design-draft')).toBeNull()
    expect(loadJson(exploreArchiveKey('s-design-7'), (v): v is { options: unknown[] } => Boolean(v))).toBeTruthy()
  })

  it('幂等：第二次调用不再上传', async () => {
    seedLegacyGlobal()
    await migrateLegacySessions()
    appendCalls = []
    const second = await migrateLegacySessions()
    expect(second.ran).toBe(false)
    expect(appendCalls).toEqual([])
  })

  it('无草稿无设计：全局历史归到"迁移的历史会话"，不丢', async () => {
    localStorage.setItem('design-chat-history', JSON.stringify([{ role: 'user', text: '无归属历史' }]))
    await migrateLegacySessions()
    expect(appendCalls.map((c) => c.key)).toEqual([ORPHAN_SESSION_KEY])
    expect(appendCalls[0].texts).toEqual(['无归属历史'])
  })

  it('上传失败（后端不可用）：不落标记、保留旧数据，下次重试', async () => {
    seedLegacyGlobal()
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('offline')
    }))
    const report = await migrateLegacySessions()
    expect(report.ran).toBe(false)
    expect(report.error).toContain('offline')
    expect(localStorage.getItem(MIGRATION_MARKER)).toBeNull()
    expect(localStorage.getItem('design-chat-history')).toBeTruthy() // 旧数据仍在
    expect(hasLegacyData()).toBe(true)
  })

  it('会话接口调用都带 session_id 声明（服务端跨会话校验用）', async () => {
    seedLegacyGlobal()
    await migrateLegacySessions()
    void sessionApi
    const fetchMock = globalThis.fetch as unknown as { mock: { calls: Array<[string, RequestInit?]> } }
    const appendReq = fetchMock.mock.calls.find(([u]) => String(u).includes('/messages'))
    expect(JSON.parse(String(appendReq?.[1]?.body)).session_id).toBeTruthy()
  })
})
