/**
 * 老数据迁移（缺陷 4）：把改造前"全局/按设计"的本地数据搬到会话结构下。
 *
 * 迁移映射：
 *   design-chat-history-{id}  → 会话 s-design-{id} 的消息（上传服务端）
 *   design-chat-history       → 草稿有 savedId 则归 s-design-{savedId}，否则 s-migrated-1（标题「迁移的历史会话」）
 *   design-explore-archive*   → {sessionKey}:explore 本地键
 *   design-base-snapshot*     → {sessionKey}:base 本地键
 *   design-draft（全局树）     → design-draft-{sessionKey}
 *
 * 安全语义（P1 修复）：
 * - 本地键"先写新键、**写入成功后才删旧键**"；写入失败（配额不足/localStorage 禁用）→ 抛错中止，
 *   旧键原样保留、不落完成标记，下次进入重试；
 * - 聊天历史旧键始终保留（只读备份，体积小）；留档/基础版/草稿为"搬迁"（成功后删旧键，避免双份占配额）；
 * - 进度按"来源键"记账（标记 ds:migration:v1 存 {complete, done[]}），失败重试不会重复上传消息。
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

type MoveKind = 'explore' | 'base' | 'draft'

interface LocalMove {
  /** 旧键（同时作为进度记账的来源键） */
  sourceKey: string
  kind: MoveKind
  value: unknown
}

interface MessageChunk {
  /** 旧键（进度记账） */
  sourceKey: string
  items: LegacyMessage[]
}

interface PlanItem {
  messages: MessageChunk[]
  localMoves: LocalMove[]
}

export interface MigrationReport {
  ran: boolean
  sessions: string[]
  messages: number
  localKeysMoved: number
  error?: string
}

/** 迁移进度（done 为"已完成的来源键"；complete=true 表示整批已完成） */
interface MigrationState {
  complete: boolean
  done: string[]
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

/** 读取迁移进度；null = 从未迁移过，"脏值/不可用"按已完成处理（避免反复迁移） */
function readState(): MigrationState | null {
  let raw: string | null = null
  try {
    raw = localStorage.getItem(MIGRATION_MARKER)
  } catch {
    return { complete: true, done: [] }
  }
  if (raw === null) return null
  if (raw === '1') return { complete: true, done: [] } // 兼容最初的布尔式标记
  try {
    const parsed = JSON.parse(raw) as MigrationState
    if (parsed && typeof parsed.complete === 'boolean' && Array.isArray(parsed.done)) return parsed
  } catch {
    /* 脏值：按完成处理 */
  }
  return { complete: true, done: [] }
}

function writeState(state: MigrationState): boolean {
  return saveJson(MIGRATION_MARKER, state)
}

/** 收集所有旧键 → 归属会话 的映射（不做任何写入） */
function collectPlan(): Map<string, PlanItem> {
  const plan = new Map<string, PlanItem>()
  const ensure = (sessionKey: string) => {
    if (!plan.has(sessionKey)) plan.set(sessionKey, { messages: [], localMoves: [] })
    return plan.get(sessionKey)!
  }

  // 1) 全局聊天历史 / 全局草稿 / 全局留档：先决定归属会话
  const legacyDraft = loadJson(draftKey(undefined), isLegacyDraft)
  const globalMessages = readLegacyMessages(LEGACY_CHAT_KEY)
  const savedId = legacyDraft?.meta?.savedId
  const homeKey = savedId ? designSessionKey(savedId) : ORPHAN_SESSION_KEY

  if (globalMessages.length > 0) {
    ensure(homeKey).messages.push({ sourceKey: LEGACY_CHAT_KEY, items: globalMessages })
  }

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
    const chatKey = `${LEGACY_CHAT_KEY}-${scope}`
    const msgs = readLegacyMessages(chatKey)
    if (msgs.length > 0) ensure(sessionKey).messages.push({ sourceKey: chatKey, items: msgs })
    const exploreKey = `${LEGACY_EXPLORE_KEY}-${scope}`
    const explore = loadJson<ExploreArchive>(exploreKey, (v): v is ExploreArchive => Boolean(v && (v as ExploreArchive).options?.length))
    if (explore) ensure(sessionKey).localMoves.push({ sourceKey: exploreKey, kind: 'explore', value: explore })
    const baseKey = `${LEGACY_BASE_KEY}-${scope}`
    const base = loadJson<BaseSnapshot>(baseKey, (v): v is BaseSnapshot => Boolean(v && (v as BaseSnapshot).design?.id))
    if (base) ensure(sessionKey).localMoves.push({ sourceKey: baseKey, kind: 'base', value: base })
  }

  // 3) 全局留档/全局草稿 → 归属会话的本地键
  const globalExplore = loadJson<ExploreArchive>(LEGACY_EXPLORE_KEY, (v): v is ExploreArchive => Boolean(v && (v as ExploreArchive).options?.length))
  if (globalExplore) ensure(homeKey).localMoves.push({ sourceKey: LEGACY_EXPLORE_KEY, kind: 'explore', value: globalExplore })
  const globalBase = loadJson<BaseSnapshot>(LEGACY_BASE_KEY, (v): v is BaseSnapshot => Boolean(v && (v as BaseSnapshot).design?.id))
  if (globalBase) ensure(homeKey).localMoves.push({ sourceKey: LEGACY_BASE_KEY, kind: 'base', value: globalBase })
  if (legacyDraft?.design) ensure(homeKey).localMoves.push({ sourceKey: draftKey(undefined), kind: 'draft', value: legacyDraft })

  return plan
}

export function isMigrationDone(): boolean {
  const state = readState()
  return state === null ? false : state.complete
}

/** 是否仍有"待迁移"的老数据（已完成的来源键不计） */
export function hasLegacyData(): boolean {
  const state = readState()
  if (state?.complete) return false
  const done = new Set(state?.done ?? [])
  try {
    for (const item of collectPlan().values()) {
      if (item.localMoves.some((m) => !done.has(m.sourceKey))) return true
      if (item.messages.some((c) => !done.has(c.sourceKey))) return true
    }
  } catch {
    return false
  }
  return false
}

/**
 * 执行迁移（幂等、可重入）。
 * 顺序：先本地搬家（失败即中止且不删旧键）→ 再上传消息；失败时 report.error 非空且不落完成标记。
 */
export async function migrateLegacySessions(): Promise<MigrationReport> {
  const report: MigrationReport = { ran: false, sessions: [], messages: 0, localKeysMoved: 0 }
  const state = readState()
  if (state?.complete) return report

  const done = new Set(state?.done ?? [])
  const plan = collectPlan()
  const markDone = (sourceKey: string) => {
    done.add(sourceKey)
    writeState({ complete: false, done: [...done] })
  }

  try {
    // ① 本地键搬家：先写新键，确认成功才删旧键（写入失败 → 抛错保留旧键，下次重试）
    for (const [sessionKey, item] of plan) {
      for (const move of item.localMoves) {
        if (done.has(move.sourceKey)) continue
        const written =
          move.kind === 'explore'
            ? saveExploreArchive(sessionKey, move.value as ExploreArchive)
            : saveJson(move.kind === 'base' ? baseSnapshotKey(sessionKey) : draftKey(sessionKey), move.value)
        if (!written) {
          throw new Error(`本地数据搬家失败（存储不可用或空间不足），已保留原键 ${move.sourceKey}，下次进入重试`)
        }
        removeJson(move.sourceKey)
        markDone(move.sourceKey)
        report.localKeysMoved += 1
      }
    }

    // ② 上传会话消息：放在本地搬家之后——此步失败也不会出现"消息未传、本地键已删"
    for (const [sessionKey, item] of plan) {
      for (const chunk of item.messages) {
        if (done.has(chunk.sourceKey)) continue
        await sessionApi.ensure(sessionKey, sessionKey.startsWith('s-design-') ? Number(sessionKey.split('-')[2]) : null)
        const payload: SessionMessage[] = chunk.items.map((m) => ({ role: m.role, text: m.text }))
        await sessionApi.append(sessionKey, payload)
        markDone(chunk.sourceKey)
        report.messages += payload.length
      }
      if (!report.sessions.includes(sessionKey)) report.sessions.push(sessionKey)
    }

    writeState({ complete: true, done: [...done] })
    report.ran = true
    return report
  } catch (err) {
    // 失败（本地写入受阻/后端不可用）：旧键保留、不落完成标记，下次进入重试
    report.error = err instanceof Error ? err.message : String(err)
    return report
  }
}
