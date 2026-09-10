/**
 * 老数据迁移（缺陷 4）：把改造前"全局/按设计"的本地数据搬到会话结构下。
 *
 * 一次性 + 幂等（标记 ds:migration:v1）；旧键保留不删（只读备份），代码不再读取。
 * 迁移映射：
 *   design-chat-history-{id}  → 会话 s-design-{id} 的消息（上传服务端）
 *   design-chat-history       → 草稿有 savedId 则归 s-design-{savedId}，否则 s-migrated-1（标题「迁移的历史会话」）
 *   design-explore-archive*   → {sessionKey}:explore 本地键
 *   design-base-snapshot*     → {sessionKey}:base 本地键
 *   design-draft（全局树）     → design-draft-{sessionKey}
 * 上传失败不落标记，下次进入重试（期间旧数据仍是可读来源，不丢）。
 */
import { saveExploreArchive, type ExploreArchive } from '@/lib/exploreArchive'
import { baseSnapshotKey, type BaseSnapshot } from '@/lib/baseSnapshot'
import { draftKey } from '@/lib/designSession'
import { loadJson, removeJson, saveJson } from '@/lib/localStore'
import { designSessionKey } from '@/lib/sessionKey'
import { sessionApi, type SessionMessage } from '@/lib/sessionApi'

export const MIGRATION_MARKER = 'ds:migration:v1'
/** 无法归属的全局历史（无草稿/无已存设计）单独成一个会话，用户可在会话列表看到并删除 */
export const ORPHAN_SESSION_KEY = 's-migrated-1'

const LEGACY_CHAT_KEY = 'design-chat-history'
const LEGACY_EXPLORE_KEY = 'design-explore-archive'
const LEGACY_BASE_KEY = 'design-base-snapshot'

interface LegacyMessage {
  role: 'user' | 'assistant'
  text: string
}

export interface MigrationReport {
  ran: boolean
  sessions: string[]
  messages: number
  localKeysMoved: number
  error?: string
}

function readLegacyMessages(key: string): LegacyMessage[] {
  const parsed = loadJson<LegacyMessage[]>(key, (v): v is LegacyMessage[] =>
    Array.isArray(v) && v.every((m) => m && typeof m.text === 'string' && (m.role === 'user' || m.role === 'assistant')),
  )
  return parsed ?? []
}

interface LegacyDraft {
  design: { id: string }
  meta?: { savedId?: number; updatedAt?: number }
}

function isLegacyDraft(v: unknown): v is LegacyDraft {
  return Boolean(v) && typeof (v as LegacyDraft).design?.id === 'string'
}

/** 收集所有旧键 → 归属会话 的映射 */
function collectPlan(): Map<string, { messages: LegacyMessage[]; localMoves: Array<[string, string, unknown]> }> {
  const plan = new Map<string, { messages: LegacyMessage[]; localMoves: Array<[string, string, unknown]> }>()
  const ensure = (sessionKey: string) => {
    if (!plan.has(sessionKey)) plan.set(sessionKey, { messages: [], localMoves: [] })
    return plan.get(sessionKey)!
  }

  // 1) 全局聊天历史 / 全局草稿 / 全局留档：先决定归属会话
  const legacyDraft = loadJson(draftKey(undefined), isLegacyDraft)
  const globalMessages = readLegacyMessages(LEGACY_CHAT_KEY)
  const savedId = legacyDraft?.meta?.savedId
  const homeKey = savedId ? designSessionKey(savedId) : ORPHAN_SESSION_KEY

  if (globalMessages.length > 0) ensure(homeKey).messages.push(...globalMessages)

  // 2) 按设计分片的旧键（design-*-{数字id}）；新式会话分片（s-xxx）不在此列
  const scopeKeys: string[] = []
  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i)
      if (!key) continue
      for (const base of [LEGACY_CHAT_KEY, LEGACY_EXPLORE_KEY, LEGACY_BASE_KEY]) {
        if (!key.startsWith(`${base}-`)) continue
        const scope = key.slice(base.length + 1)
        if (/^\d+$/.test(scope) && !scopeKeys.includes(scope)) scopeKeys.push(scope)
      }
    }
  } catch {
    /* localStorage 不可用：跳过按设计分片的部分 */
  }

  for (const scope of scopeKeys) {
    const sessionKey = designSessionKey(scope)
    const msgs = readLegacyMessages(`${LEGACY_CHAT_KEY}-${scope}`)
    if (msgs.length > 0) ensure(sessionKey).messages.push(...msgs)
    const explore = loadJson<ExploreArchive>(`${LEGACY_EXPLORE_KEY}-${scope}`, (v): v is ExploreArchive => Boolean(v && (v as ExploreArchive).options?.length))
    if (explore) ensure(sessionKey).localMoves.push([`${LEGACY_EXPLORE_KEY}-${scope}`, 'explore', explore])
    const base = loadJson<BaseSnapshot>(`${LEGACY_BASE_KEY}-${scope}`, (v): v is BaseSnapshot => Boolean(v && (v as BaseSnapshot).design?.id))
    if (base) ensure(sessionKey).localMoves.push([`${LEGACY_BASE_KEY}-${scope}`, 'base', base])
  }

  // 3) 全局留档/全局草稿 → 归属会话的本地键
  const globalExplore = loadJson<ExploreArchive>(LEGACY_EXPLORE_KEY, (v): v is ExploreArchive => Boolean(v && (v as ExploreArchive).options?.length))
  if (globalExplore) ensure(homeKey).localMoves.push([LEGACY_EXPLORE_KEY, 'explore', globalExplore])
  const globalBase = loadJson<BaseSnapshot>(LEGACY_BASE_KEY, (v): v is BaseSnapshot => Boolean(v && (v as BaseSnapshot).design?.id))
  if (globalBase) ensure(homeKey).localMoves.push([LEGACY_BASE_KEY, 'base', globalBase])
  if (legacyDraft?.design) ensure(homeKey).localMoves.push([draftKey(undefined), 'draft', legacyDraft])

  return plan
}

export function isMigrationDone(): boolean {
  try {
    return localStorage.getItem(MIGRATION_MARKER) === '1'
  } catch {
    return true // localStorage 不可用时视为无需迁移
  }
}

export function hasLegacyData(): boolean {
  try {
    return collectPlan().size > 0
  } catch {
    return false
  }
}

/** 执行迁移（幂等）：返回报告；失败时报告 error 且不落标记（下次重试） */
export async function migrateLegacySessions(): Promise<MigrationReport> {
  const report: MigrationReport = { ran: false, sessions: [], messages: 0, localKeysMoved: 0 }
  if (isMigrationDone()) return report

  const plan = collectPlan()
  if (plan.size === 0) {
    saveJson(MIGRATION_MARKER, 1)
    return report
  }

  try {
    for (const [sessionKey, item] of plan) {
      if (item.messages.length > 0) {
        await sessionApi.ensure(sessionKey, sessionKey.startsWith('s-design-') ? Number(sessionKey.split('-')[2]) : null)
        const payload: SessionMessage[] = item.messages.map((m) => ({ role: m.role, text: m.text }))
        await sessionApi.append(sessionKey, payload)
        report.messages += payload.length
      }
      for (const [oldKey, kind, value] of item.localMoves) {
        if (kind === 'explore') {
          saveExploreArchive(sessionKey, value as ExploreArchive)
          removeJson(oldKey)
        } else if (kind === 'base') {
          saveJson(baseSnapshotKey(sessionKey), value)
          removeJson(oldKey)
        } else {
          saveJson(draftKey(sessionKey), value)
          removeJson(oldKey)
        }
        report.localKeysMoved += 1
      }
      report.sessions.push(sessionKey)
    }
    saveJson(MIGRATION_MARKER, 1)
    report.ran = true
    return report
  } catch (err) {
    // 上传失败（离线/后端不可用）：保留旧键，下次进入重试
    report.error = err instanceof Error ? err.message : String(err)
    return report
  }
}
