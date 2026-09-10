/**
 * 会话快照（缺陷 4b）：每个画布会话可保存设计树快照并回退到任意历史节点。
 *
 * 存储：localStorage（按 sessionKey 分片，跨会话互不可见）；与 DesignStore 的内存快照栈
 * （AI 版撤销用）职责不同，互不影响。上限 10 条，超出淘汰最旧。
 */
import { loadJson, removeJson, saveJson, scopedKey } from '@/lib/localStore'
import type { DesignNode } from '@/design/types'

export interface SessionSnapshot {
  id: string
  at: number
  label: string
  design: DesignNode
}

const SNAP_KEY = 'session-snapshots'
export const MAX_SESSION_SNAPSHOTS = 10

export function snapshotsKey(sessionKey: string): string {
  return scopedKey(SNAP_KEY, sessionKey)
}

function isSnapshotList(v: unknown): v is SessionSnapshot[] {
  return (
    Array.isArray(v) &&
    v.every((s) => Boolean(s) && typeof s.id === 'string' && typeof s.at === 'number' && typeof s.design?.id === 'string')
  )
}

export function loadSnapshots(sessionKey: string): SessionSnapshot[] {
  const list = loadJson(snapshotsKey(sessionKey), isSnapshotList)
  return list ? [...list].sort((a, b) => b.at - a.at) : []
}

/** 保存快照（深拷贝隔离）；返回新列表（最新在前） */
export function saveSnapshot(sessionKey: string, design: DesignNode, label = ''): SessionSnapshot[] {
  const snapshot: SessionSnapshot = {
    id: `snap-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    at: Date.now(),
    label: label.trim(),
    design: JSON.parse(JSON.stringify(design)) as DesignNode,
  }
  const next = [snapshot, ...loadSnapshots(sessionKey)].slice(0, MAX_SESSION_SNAPSHOTS)
  saveJson(snapshotsKey(sessionKey), next)
  return next
}

export function deleteSnapshot(sessionKey: string, id: string): SessionSnapshot[] {
  const next = loadSnapshots(sessionKey).filter((s) => s.id !== id)
  saveJson(snapshotsKey(sessionKey), next)
  return next
}

export function clearSnapshots(sessionKey: string): void {
  removeJson(snapshotsKey(sessionKey))
}
