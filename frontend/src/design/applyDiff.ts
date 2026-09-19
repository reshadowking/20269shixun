/**
 * AI 修改的**差量落地**（2026-09-17）。
 *
 * 背景：AI 增量修改原来是 `store.resetDesign(resp.design)` —— **整树 clear + 重建**。
 * 并发下这会：① 让所有协作者的画布整体重挂（图片重载/拖拽手柄失效/位置跳变）；
 * ② 覆盖"请求发出到落地之间"别人做的改动；③ 顺带清空发起者的 Ctrl+Z 栈。
 *
 * 现在改成：把「我发出去的树(before)」与「AI 返回的树(after)」做差量，
 * **只对受影响的节点写局部 Yjs 事务**——并发面从"整棵树"缩到"被改的节点"，
 * 队友在没被 AI 碰过的节点上的改动不受影响。
 */
import type { DesignNode } from '@/design/types'

export interface DesignDiff {
  /**
   * 根 id 变了 ⇒ 这不是"同一张画布的修改"，而是**换了另一棵树**（例如空白稿 empty → root、
   * 或 AI 重新生成）。此时只能整体替换：下面三个数组都会是空的，`replace` 带上整棵新树。
   * 上轮接线失败正是漏了这一类（`locked-edit` 用例里 before=empty/after=root）。
   */
  replace?: DesignNode
  /** 删除（按深度倒序应用，先删深层） */
  removed: string[]
  /** 换父级 */
  moved: Array<{ id: string; toParent: string; index: number }>
  /**
   * 同 id、自身**部分字段**变了（不含 children——子树变化由各自的条目表达）。
   *
   * 2026-09-17（③ 字段级局部落地）：这里带的是**字段级补丁**而不是整节点快照。
   * 原来落地时整节点替换，会把"队友在这期间改了同一节点的**另一个字段**"一起吞掉
   * （实测：AI 只改 a 的样式，队友改的 a 文案被还原成旧值 = 静默丢数据）。
   * 现在只写 AI 真正改过的键，队友改的其它键原样存活。
   */
  updated: Array<{ id: string; patch: NodePatch }>
  /** 新增子树的最顶层节点（父级必须在 before 里已存在） */
  added: Array<{ parentId: string; index: number; node: DesignNode }>
  /**
   * 同父级的**相对顺序**变化（2026-09-17 修）：`moved` 只在换父级时记录，
   * 于是"把促销模块挪到最上面"（ops 的 move，父级不变）会产生一个空 diff ——
   * 落地时什么都不做，界面还会显示"没有需要改动的地方"。这里带上每个父级的目标顺序，
   * 在删/移/改/加**之后**统一按顺序就位（此时新增节点已就位，索引也才是准的）。
   */
  orders: Array<{ parentId: string; ids: string[] }>
}

/** 字段级补丁：值为 `null` 表示**删除该键/该字段**（props/style 的值不会是 null）。 */
export interface NodePatch {
  type?: string
  componentType?: string | null
  props?: Record<string, unknown | null>
  style?: Record<string, unknown | null>
  x?: number | null
  y?: number | null
  hidden?: boolean | null
}

const NODE_LEVEL_KEYS = ['type', 'componentType', 'x', 'y', 'hidden'] as const

function recordDelta(
  prev: Record<string, unknown> | undefined,
  next: Record<string, unknown> | undefined,
): Record<string, unknown | null> {
  const out: Record<string, unknown | null> = {}
  for (const key of new Set([...Object.keys(prev ?? {}), ...Object.keys(next ?? {})])) {
    const a = prev?.[key]
    const b = next?.[key]
    if (JSON.stringify(a) === JSON.stringify(b)) continue
    out[key] = b === undefined ? null : b
  }
  return out
}

/** 算出 prev → next 只动了哪些字段（供落地时只覆盖这些字段）。 */
export function patchOf(prev: DesignNode, next: DesignNode): NodePatch {
  const patch: NodePatch = {}
  if (prev.type !== next.type) patch.type = next.type
  if ((prev.componentType ?? null) !== (next.componentType ?? null)) patch.componentType = next.componentType ?? null
  const props = recordDelta(prev.props, next.props)
  if (Object.keys(props).length) patch.props = props
  const style = recordDelta(prev.style, next.style)
  if (Object.keys(style).length) patch.style = style
  // 逐个写而不是循环索引赋值：联合键名会让 TS 把目标类型收窄成 null|undefined
  if ((prev.x ?? null) !== (next.x ?? null)) patch.x = next.x ?? null
  if ((prev.y ?? null) !== (next.y ?? null)) patch.y = next.y ?? null
  if ((prev.hidden ?? null) !== (next.hidden ?? null)) patch.hidden = next.hidden ?? null
  return patch
}

/** 把字段级补丁合进"当前"节点（当前节点可能已被队友改过；没被补丁覆盖的键一律保留）。 */
export function applyNodePatch(cur: DesignNode, patch: NodePatch): DesignNode {
  const next: DesignNode = { ...cur }
  if (patch.type !== undefined) next.type = patch.type as DesignNode['type']
  if (patch.componentType !== undefined) {
    if (patch.componentType === null) delete next.componentType
    else next.componentType = patch.componentType as DesignNode['componentType']
  }
  if (patch.props) {
    const props = { ...(cur.props ?? {}) } as Record<string, unknown>
    for (const [key, value] of Object.entries(patch.props)) {
      if (value === null) delete props[key]
      else props[key] = value
    }
    next.props = props as DesignNode['props']
  }
  if (patch.style) {
    const style = { ...(cur.style ?? {}) } as Record<string, unknown>
    for (const [key, value] of Object.entries(patch.style)) {
      if (value === null) delete style[key]
      else style[key] = value
    }
    next.style = style as DesignNode['style']
  }
  for (const key of ['x', 'y', 'hidden'] as const) {
    const value = patch[key]
    if (value === undefined) continue
    if (value === null) delete next[key]
    else Object.assign(next, { [key]: value })
  }
  return next
}

/** 补丁涉及的字段名（`props.text` / `style.color` / `x`…），用于冲突判定。 */
function patchFields(patch: NodePatch): string[] {
  const fields: string[] = NODE_LEVEL_KEYS.filter((k) => patch[k] !== undefined)
  for (const key of Object.keys(patch.props ?? {})) fields.push(`props.${key}`)
  for (const key of Object.keys(patch.style ?? {})) fields.push(`style.${key}`)
  return fields
}

function fieldValue(node: DesignNode, field: string): unknown {
  const [head, tail] = field.split('.', 2)
  if (tail === undefined) return (node as unknown as Record<string, unknown>)[head] ?? null
  const bag = (node as unknown as Record<string, unknown>)[head] as Record<string, unknown> | undefined
  return bag?.[tail] ?? null
}

interface Flat {
  node: DesignNode
  parent: string | null
  index: number
  depth: number
}

function flatten(root: DesignNode): Map<string, Flat> {
  const out = new Map<string, Flat>()
  const walk = (node: DesignNode, parent: string | null, index: number, depth: number): void => {
    out.set(node.id, { node, parent, index, depth })
    ;(node.children ?? []).forEach((child, i) => walk(child, node.id, i, depth + 1))
  }
  walk(root, null, 0, 0)
  return out
}

/** 只比"节点自身"的字段：children 的变化由子节点的条目表达，避免父节点被误判为改动 */
function ownKey(node: DesignNode): string {
  return JSON.stringify({
    type: node.type,
    componentType: node.componentType ?? null,
    props: node.props ?? null,
    style: node.style ?? null,
    x: node.x ?? null,
    y: node.y ?? null,
    hidden: node.hidden ?? null,
  })
}

export function diffDesign(before: DesignNode, after: DesignNode): DesignDiff {
  if (before.id !== after.id) {
    return { replace: after, removed: [], moved: [], updated: [], added: [], orders: [] }
  }
  const b = flatten(before)
  const a = flatten(after)
  const diff: DesignDiff = { removed: [], moved: [], updated: [], added: [], orders: [] }

  // 删除：before 有、after 没有 —— 深层优先，避免删父后子节点定位失败
  diff.removed = [...b.keys()]
    .filter((id) => !a.has(id))
    .sort((x, y) => (b.get(y)?.depth ?? 0) - (b.get(x)?.depth ?? 0))

  for (const [id, next] of a) {
    const prev = b.get(id)
    if (!prev) {
      // 新增：只收"父级在 before 里已存在"的最顶层节点（整棵新子树由它带入）
      if (next.parent && b.has(next.parent)) {
        diff.added.push({ parentId: next.parent, index: next.index, node: next.node })
      }
      continue
    }
    if (prev.parent !== next.parent && next.parent) {
      diff.moved.push({ id, toParent: next.parent, index: next.index })
    }
    if (ownKey(prev.node) !== ownKey(next.node)) {
      diff.updated.push({ id, patch: patchOf(prev.node, next.node) })
    }
    // 同父级重排：只看**两棵树都还在**的孩子的相对顺序（纯新增/删除造成的位移不算重排，
    // 那种情况 added/removed 已经表达，重排步骤会自己变成无操作）。
    const beforeIds = (prev.node.children ?? []).map((c) => c.id)
    const afterIds = (next.node.children ?? []).map((c) => c.id)
    const beforeCommon = beforeIds.filter((id) => afterIds.includes(id))
    const afterCommon = afterIds.filter((id) => beforeIds.includes(id))
    if (beforeCommon.join(',') !== afterCommon.join(',')) {
      diff.orders.push({ parentId: id, ids: afterIds })
    }
  }
  return diff
}

/** 能施加差量的最小 store 接口（便于单测注入） */
export interface DiffTarget {
  resetDesign(design: DesignNode): void
  removeNode(id: string): void
  moveNodeTo(id: string, newParentId: string, index: number): void
  updateNode(id: string, updater: (node: DesignNode) => DesignNode): void
  insertChild(parentId: string, node: DesignNode, index?: number): void
  /** 按目标顺序重排某父级的子节点（同父级重排必须走它，moveNodeTo 不覆盖这一情形） */
  reorderChildren(parentId: string, orderedIds: string[]): void
}

/**
 * 按差量落地：删 → 移 → 改 → 加。
 * 每一步都是**局部事务**（因此队友在其它节点上的并发改动不会被整树替换吞掉）。
 */
export function applyDesignDiff(store: DiffTarget, diff: DesignDiff): void {
  if (diff.replace) {
    store.resetDesign(diff.replace)
    return
  }
  for (const id of diff.removed) store.removeNode(id)
  for (const m of diff.moved) store.moveNodeTo(m.id, m.toParent, m.index)
  // 字段级合并：只写 AI 改过的键，队友在**同一节点其它字段**上的并发改动存活
  for (const u of diff.updated) store.updateNode(u.id, (cur) => applyNodePatch(cur, u.patch))
  for (const add of diff.added) store.insertChild(add.parentId, add.node, add.index)
  // 顺序最后统一修：只有此时"整份 children 都在"（新增已插入、删除已生效），索引才与 after 对齐
  for (const o of diff.orders) store.reorderChildren(o.parentId, o.ids)
}

/** 从补丁里去掉若干字段（`props.text` 要把 props 里的那个键拿掉，空了就删掉整个 props）。 */
function omitPatchFields(patch: NodePatch, fields: string[]): NodePatch {
  const out = { ...patch } as unknown as Record<string, unknown>
  for (const field of fields) {
    const [head, tail] = field.split('.', 2)
    if (tail === undefined) {
      delete out[head]
      continue
    }
    const bag = { ...((out[head] as Record<string, unknown> | undefined) ?? {}) }
    delete bag[tail]
    if (Object.keys(bag).length) out[head] = bag
    else delete out[head]
  }
  return out as NodePatch
}

export interface AiLandingPlan {
  /** 可以直接落地的差量（冲突字段/节点已被剔除） */
  diff: DesignDiff
  /** 因队友并发改动而**跳过**的字段：{ id, fields }（这些字段保持队友的值） */
  skipped: Array<{ id: string; fields: string[] }>
  /** 结构性冲突（节点被删/被移/顺序被改）：**非空时不要落地**，整批中止并提示用户重发 */
  blocked: string[]
}

/**
 * ③ 的收口（2026-09-17）：AI 请求是**基于快照**的（发出去的 `before`），落地前先核对前置条件。
 *
 * 之前只做到"字段级落地 + 事后提示"——队友改了**同一个字段**时我们仍然覆盖他，只是弹一句
 * "已覆盖"。现在：
 *
 * - **属性类**：逐字段核对"当前值是否仍等于快照值"。被队友动过的字段从补丁里剔除并记进
 *   `skipped`（保留队友的版本），其余字段照常落地（可 Ctrl+Z）。
 * - **结构类**（删除 / 换父级 / 同父级重排 / 往某父级插入）：前置条件一被破坏就记进 `blocked`，
 *   由调用方**整批中止**——半套结构改动比不落地更难收拾，也让用户有机会重发。
 *
 * 返回的 `diff` 即"可落地的部分"；`blocked` 非空时调用方必须忽略它、什么都不写。
 */
export function planAiLanding(before: DesignNode, current: DesignNode, diff: DesignDiff): AiLandingPlan {
  // 根 id 变了（空白稿 empty → root）＝换了另一棵树，没有可比的前置条件，维持整体替换语义
  if (diff.replace || before.id !== current.id) {
    return { diff, skipped: [], blocked: [] }
  }
  const b = flatten(before)
  const c = flatten(current)
  const blocked: string[] = []
  const skipped: Array<{ id: string; fields: string[] }> = []

  // ① 属性类：逐字段核对
  const updated: DesignDiff['updated'] = []
  for (const u of diff.updated) {
    const prev = b.get(u.id)
    const now = c.get(u.id)
    if (!prev || !now) {
      // 节点被队友删了：这次就改不成（但不阻断其余改动，也不把它复活）
      skipped.push({ id: u.id, fields: patchFields(u.patch) })
      continue
    }
    const conflicted = patchFields(u.patch).filter(
      (f) => JSON.stringify(fieldValue(prev.node, f)) !== JSON.stringify(fieldValue(now.node, f)),
    )
    if (conflicted.length) skipped.push({ id: u.id, fields: conflicted })
    const patch = conflicted.length ? omitPatchFields(u.patch, conflicted) : u.patch
    if (Object.keys(patch).length) updated.push({ id: u.id, patch })
  }

  // ② 删除：队友还在编辑的节点不能悄悄删掉（他的改动会跟着消失）
  const removed = diff.removed.filter((id) => {
    const prev = b.get(id)
    const now = c.get(id)
    if (!now) return false // 已经被队友删了：目的已达成
    if (!prev || ownKey(prev.node) !== ownKey(now.node) || prev.parent !== now.parent) {
      blocked.push(id)
      return false
    }
    return true
  })

  // ③ 换父级：队友已经把它移走了就不要硬拉回来
  const moved = diff.moved.filter((m) => {
    const prev = b.get(m.id)
    const now = c.get(m.id)
    if (!prev || !now || now.parent !== prev.parent) {
      blocked.push(m.id)
      return false
    }
    return true
  })

  // ④ 新增：父级必须还在
  const added = diff.added.filter((a) => {
    if (!c.has(a.parentId)) {
      blocked.push(a.parentId)
      return false
    }
    return true
  })

  // ⑤ 同父级重排：队友动过这个父级的顺序，就不要按旧快照覆盖
  const orders = diff.orders.filter((o) => {
    const prev = b.get(o.parentId)
    const now = c.get(o.parentId)
    if (!prev || !now) {
      blocked.push(o.parentId)
      return false
    }
    const nowIds = (now.node.children ?? []).map((child) => child.id)
    const beforeCommon = (prev.node.children ?? []).map((child) => child.id).filter((id) => nowIds.includes(id))
    const nowCommon = nowIds.filter((id) => (prev.node.children ?? []).some((child) => child.id === id))
    if (beforeCommon.join(',') !== nowCommon.join(',')) {
      blocked.push(o.parentId)
      return false
    }
    return true
  })

  return {
    diff: { removed, moved, updated, added, orders },
    skipped,
    blocked: [...new Set(blocked)],
  }
}
