/**
 * 设计会话工具（缺陷 5/8/11 + 缺陷 4 会话化）：草稿自动保存 + 打开设计元信息。
 *
 * 缺陷 4：草稿按 sessionKey 分片（design-draft-{sessionKey}），修掉"多画布互相覆盖"；
 * 旧全局键 design-draft 作为迁移来源保留读取，"继续上次编辑"取最近一份草稿（含旧键）。
 */
import { loadJson, removeJson, saveJson, scopedKey } from '@/lib/localStore'
import type { DesignNode } from '@/design/types'

export interface DesignSessionMeta {
  /** 已保存到后端的设计 id（未保存为 undefined） */
  savedId?: number
  savedName?: string
  updatedAt: number
}

const DRAFT_KEY = 'design-draft'

export interface Draft {
  design: DesignNode
  meta: DesignSessionMeta
}

export function draftKey(sessionKey?: string): string {
  return scopedKey(DRAFT_KEY, sessionKey)
}

function isDraft(v: unknown): v is Draft {
  if (!v || typeof v !== 'object') return false
  const parsed = v as Draft
  return typeof parsed.design?.id === 'string'
}

export function loadDraft(sessionKey?: string): Draft | null {
  return loadJson(draftKey(sessionKey), isDraft)
}

/**
 * 保存草稿；返回**是否写成功**。
 *
 * 2026-09-17：此前返回 void，`saveJson` 的失败（localStorage 配额满 / 被禁用）被静默吞掉——
 * 用户以为草稿一直在，关掉标签页就什么都没了。调用方据此给可见提示（服务端保存仍可兜底）。
 */
export function saveDraft(
  sessionKey: string | undefined,
  design: DesignNode,
  meta: Partial<DesignSessionMeta> = {},
): boolean {
  const prev = loadDraft(sessionKey)
  return saveJson(draftKey(sessionKey), {
    design,
    meta: {
      savedId: meta.savedId ?? prev?.meta.savedId,
      savedName: meta.savedName ?? prev?.meta.savedName,
      updatedAt: Date.now(),
    },
  })
}

export function clearDraft(sessionKey?: string): void {
  removeJson(draftKey(sessionKey))
}

/**
 * 最近一份草稿（含旧全局键 design-draft）：供首页「继续上次编辑」。
 * 返回 sessionKey=null 表示命中的是迁移前的旧全局草稿（走 ?from=draft 兼容路径）。
 */
export function loadLatestDraft(): { sessionKey: string | null; draft: Draft } | null {
  const candidates: Array<{ sessionKey: string | null; draft: Draft }> = []
  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i)
      if (!key) continue
      if (key === DRAFT_KEY) {
        const draft = loadDraft(undefined)
        if (draft) candidates.push({ sessionKey: null, draft })
        continue
      }
      if (key.startsWith(`${DRAFT_KEY}-`)) {
        const scope = key.slice(DRAFT_KEY.length + 1)
        const draft = loadDraft(scope)
        if (draft) candidates.push({ sessionKey: scope, draft })
      }
    }
  } catch {
    return null
  }
  if (candidates.length === 0) return null
  return candidates.reduce((best, cur) => (cur.draft.meta.updatedAt > best.draft.meta.updatedAt ? cur : best))
}
