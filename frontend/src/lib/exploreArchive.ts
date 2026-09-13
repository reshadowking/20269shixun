/**
 * 方案探索留档（缺陷 1）：选定某方案后，两套方案详情保留可查、刷新后仍可还原"我选过哪个方案"。
 *
 * 存储选型：localStorage（不走 IndexedDB / PostgreSQL / Redis）。
 * 理由：① 该数据和 design-draft、design-chat-history 同层——都是"当前浏览器会话的 UI 状态"，
 * 复用同一个 key 约定（historyScope：已存设计按 design-{id} 分片）；② 不引入新依赖、不改后端表结构；
 * ③ 选定方案本身已经通过草稿/保存链路持久化，这里只留"对比记录"。
 * 容量风险：localStorage 约 5MB，两套方案树典型 40KB 级；写入失败（配额/禁用）时返回 false，
 * 由调用方降级为"本次会话内可查"，不阻塞选定流程。
 */
import { loadJson, removeJson, saveJson, scopedKey } from '@/lib/localStore'
import type { DesignNode } from '@/design/types'

/** 与 /api/generate/explore 响应对齐的单份方案 */
export interface ExploreOption {
  label: string
  design: DesignNode
  template: string
  compliance: number
  violations: number
  /** 该方案是否降级（模型不可用回退预置模板） */
  fallback?: boolean
  /** 是否演示模式产出（未配置模型 Key 的模板稿，须与模型产物显式区分） */
  mock?: boolean
  /** T10 批2（§4.8 #16）：组件能力降级明细（["icon@id"]，命名避开顶层 degraded: bool） */
  degraded_kinds?: string[]
}

export interface ExploreOptionLists {
  options: ExploreOption[]
  degraded: boolean
}

/** 已选定方案后的对比留档 */
export interface ExploreArchive extends ExploreOptionLists {
  /** 用户选定的方案下标 */
  chosenIndex: number
  /** 留档时间戳（由 saveExploreArchive 写入） */
  at?: number
}

const ARCHIVE_KEY = 'design-explore-archive'

/** 按 scope 分 key（与 chatStorageKey 同构：已存设计按 design id 隔离，未保存路径退回全局 key） */
export function exploreArchiveKey(scope?: string): string {
  return scopedKey(ARCHIVE_KEY, scope)
}

function isArchive(v: unknown): v is ExploreArchive {
  if (!v || typeof v !== 'object') return false
  const parsed = v as ExploreArchive
  if (!Array.isArray(parsed.options) || parsed.options.length === 0) return false
  const okOptions = parsed.options.every(
    (o) => o && typeof o.label === 'string' && typeof o.design?.id === 'string',
  )
  if (!okOptions) return false
  return (
    typeof parsed.chosenIndex === 'number' &&
    parsed.chosenIndex >= 0 &&
    parsed.chosenIndex < parsed.options.length
  )
}

export function loadExploreArchive(scope?: string): ExploreArchive | null {
  const parsed = loadJson(exploreArchiveKey(scope), isArchive)
  if (!parsed) return null
  return {
    options: parsed.options,
    degraded: Boolean(parsed.degraded),
    chosenIndex: parsed.chosenIndex,
    at: typeof parsed.at === 'number' ? parsed.at : 0,
  }
}

/** 写入留档（自动打时间戳）；返回是否成功（失败由调用方降级为会话内可查，不影响选定本身） */
export function saveExploreArchive(scope: string | undefined, archive: ExploreArchive): boolean {
  return saveJson(exploreArchiveKey(scope), { ...archive, at: Date.now() })
}

export function clearExploreArchive(scope?: string): void {
  removeJson(exploreArchiveKey(scope))
}
