/**
 * 基础版快照（缺陷 3）：版面确认时保留一份"没有任何高级效果"的设计树，
 * 后续美化操作只改实时树，不改这份快照——「对比原始版面」与「临时关闭全部高级效果」都读它。
 *
 * 存储：localStorage（与设计草稿、方案留档同层，按 historyScope 分片）；
 * 快照在写入时深拷贝，确保即使调用方后续复用同一对象也互不影响。
 */
import { loadJson, removeJson, saveJson, scopedKey } from '@/lib/localStore'
import type { DesignNode } from '@/design/types'

export interface BaseSnapshot {
  /** 版面确认时的设计树（无高级效果） */
  design: DesignNode
  /** 确认时间戳 */
  at: number
}

const BASE_KEY = 'design-base-snapshot'

export function baseSnapshotKey(scope?: string): string {
  return scopedKey(BASE_KEY, scope)
}

function isBaseSnapshot(v: unknown): v is BaseSnapshot {
  if (!v || typeof v !== 'object') return false
  const snap = v as BaseSnapshot
  return typeof snap.design?.id === 'string' && typeof snap.at === 'number'
}

export function loadBaseSnapshot(scope?: string): BaseSnapshot | null {
  return loadJson(baseSnapshotKey(scope), isBaseSnapshot)
}

/** 保存基础版快照（深拷贝，与后续实时树彻底解耦）；返回是否成功 */
export function saveBaseSnapshot(scope: string | undefined, design: DesignNode): boolean {
  return saveJson(baseSnapshotKey(scope), {
    design: JSON.parse(JSON.stringify(design)) as DesignNode,
    at: Date.now(),
  })
}

export function clearBaseSnapshot(scope?: string): void {
  removeJson(baseSnapshotKey(scope))
}
