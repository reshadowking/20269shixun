/**
 * 变更清单（T49 交付 2）：把"前后两棵树"翻译成**可逐条撤回的人类可读列表**。
 *
 * 设计要点：
 * - **一条 = 节点 × 变更类型**（不是节点级）。原因：单条撤回是把该项的差量反向喂回
 *   `store.applyAiDiff`，而 `applyAiDiff` 逐个分量各自开事务（**不是**一个事务）——
 *   只有"一条只含一个分量"时，撤回才恰好是一个撤销步（一次 Ctrl+Z 可退）。
 *   `modified` 的多个字段仍落在**同一个 NodePatch** 里，所以它们天然是一条。
 * - **`ineffective` 是字段级**，不是条目级：同一节点可能"改文案生效了、改的样式键渲染层
 *   不支持"，整条判无效会把生效的改动一起误杀。
 * - **`revertBlocked` 统一判据**：撤回差量引用的任何 `parentId` 在 **after 树**里不存在
 *   （原父级被同时删掉）→ 不给单条撤回按钮，提示用 Ctrl+Z。`removed` 只是其中一个特例。
 *
 * 本模块是纯函数（不碰 store、不 import 组件注册表），便于单测与复用。
 */
import { patchOf, type DesignDiff } from './applyDiff'
import { isRenderableStyleKey, styleKeyLabel } from './styleKeys'
import type { DesignNode } from './types'

export type ChangeKind = 'added' | 'removed' | 'modified' | 'moved' | 'reordered'

export interface FieldChange {
  scope: 'style' | 'props' | 'x' | 'y' | 'hidden'
  /** style/props 的键名；x/y/hidden 为空串 */
  key: string
  from: unknown
  to: unknown
  /** 该字段"数据改了但渲染不出来"的原因（字段级，不是条目级） */
  ineffective?: string
}

export interface ChangeItem {
  /** 节点 id（-1 不会出现；沿用被改节点的 id） */
  id: string
  /** 人类可读标题：文本内容 → componentType → type */
  title: string
  kind: ChangeKind
  fields: FieldChange[]
  /** 单行摘要（卡片直接渲染它） */
  summary: string
  /** 至少有一个字段真的生效 */
  hasEffective: boolean
  /** 所有字段都不生效（此时回执不能说"已应用修改 ✓"） */
  allIneffective: boolean
  /** 反转这一条所需的差量（**只含一个分量**） */
  revert: DesignDiff
  /** 有值时表示不能单条撤回（提示用 Ctrl+Z） */
  revertBlocked?: string
}

interface Flat {
  node: DesignNode
  parent: string | null
  index: number
}

function flatten(tree: DesignNode): Map<string, Flat> {
  const out = new Map<string, Flat>()
  const walk = (node: DesignNode, parent: string | null, index: number) => {
    out.set(node.id, { node, parent, index })
    ;(node.children ?? []).forEach((child, i) => walk(child, node.id, i))
  }
  walk(tree, null, 0)
  return out
}

/** 空差量（`revert` 的骨架；`applyAiDiff` 认这个形状） */
export function emptyDiff(): DesignDiff {
  return { removed: [], moved: [], updated: [], added: [], orders: [] }
}

function formatValue(value: unknown): string {
  if (value === undefined || value === null || value === '') return '无'
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value)
  return text.length > 24 ? `${text.slice(0, 24)}…` : text
}

/** 节点标题：有文本用文本（最容易被认出来），否则用组件类型 */
export function nodeTitle(node: DesignNode): string {
  const raw = (node.props as Record<string, unknown> | undefined)?.text
  const text = typeof raw === 'string' ? raw.trim() : ''
  if (text) return text.length > 12 ? `${text.slice(0, 12)}…` : text
  return node.componentType ?? node.type
}

function typeLabel(node: DesignNode): string {
  return node.componentType ?? node.type
}

/** 逐字段比较节点自身（children 由各自条目表达，不算父节点改动） */
function fieldChanges(
  before: DesignNode,
  after: DesignNode,
  afterParentLayout: string | undefined,
): FieldChange[] {
  const out: FieldChange[] = []
  // 位置：父容器不是 free 布局时 x/y 不渲染（ops 已把值写对，但流式布局下是空操作）
  const positionIneffective =
    afterParentLayout === undefined
      ? '顶层节点没有绝对定位父容器，位置调整不生效'
      : afterParentLayout !== 'free'
        ? '父容器是流式布局（row/column/grid），位置调整不生效'
        : undefined
  for (const axis of ['x', 'y'] as const) {
    if ((before[axis] ?? null) !== (after[axis] ?? null)) {
      out.push({ scope: axis, key: '', from: before[axis], to: after[axis], ineffective: positionIneffective })
    }
  }
  if ((before.hidden ?? false) !== (after.hidden ?? false)) {
    out.push({ scope: 'hidden', key: '', from: before.hidden, to: after.hidden })
  }
  const beforeProps = (before.props ?? {}) as Record<string, unknown>
  const afterProps = (after.props ?? {}) as Record<string, unknown>
  for (const key of new Set([...Object.keys(beforeProps), ...Object.keys(afterProps)])) {
    if (JSON.stringify(beforeProps[key]) !== JSON.stringify(afterProps[key])) {
      out.push({ scope: 'props', key, from: beforeProps[key], to: afterProps[key] })
    }
  }
  const beforeStyle = (before.style ?? {}) as Record<string, unknown>
  const afterStyle = (after.style ?? {}) as Record<string, unknown>
  for (const key of new Set([...Object.keys(beforeStyle), ...Object.keys(afterStyle)])) {
    if (JSON.stringify(beforeStyle[key]) !== JSON.stringify(afterStyle[key])) {
      out.push({
        scope: 'style',
        key,
        from: beforeStyle[key],
        to: afterStyle[key],
        // 渲染层不认的样式键：写了、计数了，但画布不会变
        ineffective: isRenderableStyleKey(key) ? undefined : '渲染层不支持这个样式键',
      })
    }
  }
  return out
}

function fieldLine(field: FieldChange): string {
  const label =
    field.scope === 'style'
      ? styleKeyLabel(field.key)
      : field.scope === 'props'
        ? `文案（${field.key}）`
        : field.scope === 'x'
          ? '横坐标'
          : field.scope === 'y'
            ? '纵坐标'
            : '可见性'
  const arrow = `${formatValue(field.from)} → ${formatValue(field.to)}`
  return field.ineffective ? `${label} ${arrow}（未生效）` : `${label} ${arrow}`
}

/** 撤回差量引用的 parentId 必须存在于 after 树，否则单条撤回无法安全执行 */
function blockedReason(revert: DesignDiff, afterIds: Set<string>): string | undefined {
  const referenced = [
    ...revert.moved.map((m) => m.toParent),
    ...revert.added.map((a) => a.parentId),
    ...revert.orders.map((o) => o.parentId),
  ]
  return referenced.some((id) => !afterIds.has(id))
    ? '原父级已删除，需用 Ctrl+Z 整体撤销'
    : undefined
}

function finish(item: Omit<ChangeItem, 'hasEffective' | 'allIneffective'>, afterIds: Set<string>): ChangeItem {
  const ineffectiveFlags = item.fields.map((f) => Boolean(f.ineffective))
  return {
    ...item,
    hasEffective: item.fields.length === 0 || ineffectiveFlags.some((flag) => !flag),
    allIneffective: item.fields.length > 0 && ineffectiveFlags.every(Boolean),
    revertBlocked: blockedReason(item.revert, afterIds),
  }
}

/**
 * 生成变更清单。
 *
 * 顺序：修改 → 新增 → 删除 → 移动 → 重排（最常关心的"改了哪些属性"排最前）。
 */
export function buildChangeList(before: DesignNode, after: DesignNode): ChangeItem[] {
  const beforeFlat = flatten(before)
  const afterFlat = flatten(after)
  const afterIds = new Set(afterFlat.keys())
  const items: ChangeItem[] = []

  // ① 修改（同一节点的全部字段落在一条里，撤回时是一个 NodePatch → 一个撤销步）
  for (const [id, next] of afterFlat) {
    const prev = beforeFlat.get(id)
    if (!prev) continue
    const fields = fieldChanges(prev.node, next.node, next.parent ? (afterFlat.get(next.parent)?.node.style?.layout as string | undefined) : undefined)
    if (fields.length === 0) continue
    items.push(
      finish(
        {
          id,
          title: nodeTitle(next.node),
          kind: 'modified',
          fields,
          summary: fields.map(fieldLine).join('；'),
          revert: { ...emptyDiff(), updated: [{ id, patch: patchOf(next.node, prev.node) }] },
        },
        afterIds,
      ),
    )
  }

  // ② 新增（整棵新子树算一条：撤回时整体移除；子树内部字段不逐条列）
  for (const [id, next] of afterFlat) {
    if (beforeFlat.has(id)) continue
    const parentExistsBefore = next.parent ? beforeFlat.has(next.parent) : false
    if (next.parent && !parentExistsBefore) continue // 父级也是新增 → 由父级那条带走
    items.push(
      finish(
        {
          id,
          title: nodeTitle(next.node),
          kind: 'added',
          fields: [],
          summary: `新增（${typeLabel(next.node)}）`,
          revert: { ...emptyDiff(), removed: [id] },
        },
        afterIds,
      ),
    )
  }

  // ③ 删除（撤回＝把旧子树插回原位）
  for (const [id, prev] of beforeFlat) {
    if (afterFlat.has(id)) continue
    const parentStillExists = prev.parent ? afterFlat.has(prev.parent) : false
    if (prev.parent && !parentStillExists) continue // 父级也被删 → 由父级那条带走/整体撤销
    items.push(
      finish(
        {
          id,
          title: nodeTitle(prev.node),
          kind: 'removed',
          fields: [],
          summary: `删除（${typeLabel(prev.node)}）`,
          revert: prev.parent
            ? { ...emptyDiff(), added: [{ parentId: prev.parent, index: prev.index, node: prev.node }] }
            : emptyDiff(),
        },
        afterIds,
      ),
    )
  }

  // ④ 换父级（撤回＝移回旧父/旧位置）
  for (const [id, next] of afterFlat) {
    const prev = beforeFlat.get(id)
    if (!prev || prev.parent === next.parent) continue
    if (!next.parent || !prev.parent) continue // 根节点换父级或涉及根的新增/删除不在此处理
    const target = afterFlat.get(next.parent)
    items.push(
      finish(
        {
          id,
          title: nodeTitle(next.node),
          kind: 'moved',
          fields: [],
          summary: `移动到「${target ? nodeTitle(target.node) : next.parent}」的第 ${next.index + 1} 位`,
          revert: { ...emptyDiff(), moved: [{ id, toParent: prev.parent, index: prev.index }] },
        },
        afterIds,
      ),
    )
  }

  // ⑤ 同父级重排（只看两棵树都还在的孩子的相对顺序，避免与新增/删除重复计数）
  for (const [id, next] of afterFlat) {
    const prev = beforeFlat.get(id)
    if (!prev) continue
    const beforeIds = (prev.node.children ?? []).map((c) => c.id)
    const afterIdsList = (next.node.children ?? []).map((c) => c.id)
    const beforeCommon = beforeIds.filter((cid) => afterIdsList.includes(cid))
    const afterCommon = afterIdsList.filter((cid) => beforeIds.includes(cid))
    if (beforeCommon.length < 2 || beforeCommon.join(',') === afterCommon.join(',')) continue
    items.push(
      finish(
        {
          id,
          title: nodeTitle(next.node),
          kind: 'reordered',
          fields: [],
          summary: '调整了内部子项顺序',
          revert: { ...emptyDiff(), orders: [{ parentId: id, ids: beforeIds }] },
        },
        afterIds,
      ),
    )
  }

  return items
}

/** 卡片顶部计数用：生效条目数 / 全部无效条目数 */
export function summarizeChanges(items: ChangeItem[]): {
  total: number
  effective: number
  allIneffective: number
  ineffectiveFields: number
} {
  const effectiveItems = items.filter((i) => i.hasEffective)
  const ineffectiveFields = items.reduce((n, i) => n + i.fields.filter((f) => f.ineffective).length, 0)
  return {
    total: items.length,
    effective: effectiveItems.length,
    allIneffective: items.filter((i) => i.allIneffective).length,
    ineffectiveFields,
  }
}

/**
 * 降级明细（T51 验收反馈）：把后端的 `"能力@节点id"` 翻成人话。
 *
 * 这些是"模型想要但链路表达不了"的能力——**完善组件库/效果库的原料**，
 * 必须逐条列出而不是只报个数（用户原话：要根据不支持的能力去完善组件库）。
 */
export function describeDegraded(entries: string[]): string[] {
  return entries.map((entry) => {
    const at = entry.lastIndexOf('@')
    if (at <= 0) return entry
    const capability = entry.slice(0, at)
    const nodeId = entry.slice(at + 1)
    return `「${capability}」（节点 ${nodeId}）`
  })
}
