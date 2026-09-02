/**
 * 设计会话工具（缺陷 5/8/11）：localStorage 自动草稿 + 打开设计元信息。
 * 草稿保存最近一次编辑（含已保存设计的 id/名称），刷新/误关不丢。
 */
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

export function loadDraft(): Draft | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { design?: DesignNode; meta?: DesignSessionMeta }
    if (!parsed.design?.id) return null
    return { design: parsed.design, meta: parsed.meta ?? { updatedAt: Date.now() } }
  } catch {
    return null
  }
}

export function saveDraft(design: DesignNode, meta: Partial<DesignSessionMeta> = {}): void {
  try {
    const prev = loadDraft()
    localStorage.setItem(
      DRAFT_KEY,
      JSON.stringify({
        design,
        meta: {
          savedId: meta.savedId ?? prev?.meta.savedId,
          savedName: meta.savedName ?? prev?.meta.savedName,
          updatedAt: Date.now(),
        },
      }),
    )
  } catch {
    /* localStorage 满/禁用时静默 */
  }
}

export function clearDraft(): void {
  localStorage.removeItem(DRAFT_KEY)
}
