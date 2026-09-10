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

/** 读取迁移标记（P1 后为 {complete, done[]}） */
function markerState(): { complete: boolean; done: string[] } | null {
  const raw = localStorage.getItem(MIGRATION_MARKER)
  return raw ? (JSON.parse(raw) as { complete: boolean; done: string[] }) : null
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
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    localStorage.clear()
  })

  it('无老数据：直接落标记，不做任何上传', async () => {
    const report = await migrateLegacySessions()
    expect(report.sessions).toEqual([])
    expect(appendCalls).toEqual([])
    expect(markerState()?.complete).toBe(true)
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
    expect(markerState()?.complete).toBe(true)
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
    expect(markerState()?.complete).not.toBe(true) // 未落"完成"标记（进度可存在）
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

  it('P1 本地搬家写入失败：旧键仍在、不落完成标记、报告带 error、可重试补齐', async () => {
    seedLegacyGlobal()
    const realSetItem = Storage.prototype.setItem
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key: string, value: string) {
      // 模拟配额不足：新键（会话分片）写入失败
      if (key.startsWith('design-draft-') || key.includes('design-base-snapshot-s-')) {
        throw new Error('QuotaExceededError')
      }
      return realSetItem.call(this, key, value)
    })

    const first = await migrateLegacySessions()
    expect(first.ran).toBe(false)
    expect(first.error).toContain('搬家失败')
    // 核心断言：写入失败的新键，其旧键必须原样保留（不能"新键没写成、旧键已删"）
    expect(localStorage.getItem('design-base-snapshot')).toBeTruthy()
    expect(localStorage.getItem('design-draft')).toBeTruthy()
    // 在失败之前已成功搬迁的旧键可以删，但数据必须在新键上（不丢）
    expect(localStorage.getItem(exploreArchiveKey('s-design-7'))).toBeTruthy()
    // 未落完成标记，下次进入仍会重试
    expect(markerState()?.complete).not.toBe(true)
    expect(hasLegacyData()).toBe(true)
    // 新顺序为"先上传、后搬家"：上传已完成（且标记了 done），重试时不会重复上传
    expect(appendCalls.flatMap((c) => c.texts)).toEqual(['老朋友的问题', '设计 9 的历史'])

    // 恢复存储后重试：一次补齐，且消息只上传一次
    spy.mockRestore()
    const second = await migrateLegacySessions()
    expect(second.ran).toBe(true)
    expect(second.messages).toBe(0) // 消息在第一次运行已上传并记账，重试不重复
    expect(second.localKeysMoved).toBeGreaterThanOrEqual(2) // 重试补齐剩余的本地搬家
    expect(markerState()?.complete).toBe(true)
    expect(appendCalls.flatMap((c) => c.texts)).toEqual(['老朋友的问题', '设计 9 的历史'])
    expect(localStorage.getItem('design-base-snapshot-s-design-7')).toBeTruthy()
  })

  it('P1 部分搬家失败后重试：已搬走的来源键不重复处理，未搬的补齐', async () => {
    seedLegacyGlobal()
    // 只让"基础版快照"写入失败，留档/草稿先搬成功
    const realSetItem = Storage.prototype.setItem
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key: string, value: string) {
      if (key.includes('design-base-snapshot-s-')) throw new Error('QuotaExceededError')
      return realSetItem.call(this, key, value)
    })
    const first = await migrateLegacySessions()
    expect(first.ran).toBe(false)
    expect(first.localKeysMoved).toBeGreaterThanOrEqual(1) // 失败前的来源键已搬走
    expect(localStorage.getItem(exploreArchiveKey('s-design-7'))).toBeTruthy() // 已搬迁的数据在新键
    expect(localStorage.getItem('design-draft')).toBeTruthy() // 未搬到的旧键仍在

    spy.mockRestore()
    const second = await migrateLegacySessions()
    expect(second.ran).toBe(true)
    expect(localStorage.getItem('design-draft')).toBeNull()
    expect(localStorage.getItem(baseSnapshotKey('s-design-7'))).toBeTruthy()
    // 消息只上传一次（进度按来源键记账）
    expect(appendCalls.flatMap((c) => c.texts).filter((t) => t === '老朋友的问题')).toHaveLength(1)
  })

  it('旧代码持久化的欢迎语占位不当作真实消息上传（避免查看会话时两条欢迎语）', async () => {
    localStorage.setItem(
      'design-chat-history',
      JSON.stringify([
        { role: 'assistant', text: '你好！我是 AI 设计助手。输入你的需求，我帮你生成设计稿。' },
        { role: 'user', text: '真的需求' },
      ]),
    )
    await migrateLegacySessions()
    expect(appendCalls.flatMap((c) => c.texts)).toEqual(['真的需求'])
  })

  it('同标签并发调用只跑一次（in-flight 去重）', async () => {
    seedLegacyGlobal()
    const [a, b] = await Promise.all([migrateLegacySessions(), migrateLegacySessions()])
    expect(a).toBe(b) // 返回同一个报告对象
    expect(appendCalls.flatMap((c) => c.texts)).toEqual(['老朋友的问题', '设计 9 的历史']) // 未重复上传
    expect(markerState()?.complete).toBe(true)

    // 去重状态必须清理干净：后续调用能正常再次执行（换一批老数据）
    localStorage.removeItem(MIGRATION_MARKER)
    localStorage.setItem('design-chat-history', JSON.stringify([{ role: 'user', text: '第二批' }]))
    const third = await migrateLegacySessions()
    expect(third.ran).toBe(true)
    expect(appendCalls.flatMap((c) => c.texts)).toContain('第二批')
  })

  it('归属一次定音：草稿已被搬走但标记记了 homeKey 时，重试仍归原会话', async () => {
    // 模拟：首次运行已搬走草稿并记下 homeKey，但消息上传未完成
    localStorage.setItem(
      MIGRATION_MARKER,
      JSON.stringify({ complete: false, done: ['design-draft'], homeKey: 's-design-7' }),
    )
    localStorage.setItem('design-chat-history', JSON.stringify([{ role: 'user', text: '待补传' }]))

    const report = await migrateLegacySessions()
    expect(report.ran).toBe(true)
    expect(appendCalls.map((c) => c.key)).toEqual(['s-design-7']) // 不回退成 orphan
    expect(appendCalls[0].texts).toEqual(['待补传'])
  })

  it('跨标签锁：他人持锁时本次跳过；锁过期后可继续', async () => {
    seedLegacyGlobal()
    localStorage.setItem('ds:migration:lock', String(Date.now()))
    const blocked = await migrateLegacySessions()
    expect(blocked.ran).toBe(false)
    expect(appendCalls).toEqual([])
    expect(localStorage.getItem('design-chat-history')).toBeTruthy() // 数据没动

    localStorage.setItem('ds:migration:lock', String(Date.now() - 60_000)) // 过期锁
    const ok = await migrateLegacySessions()
    expect(ok.ran).toBe(true)
    expect(appendCalls.flatMap((c) => c.texts)).toContain('老朋友的问题')
  })
})
