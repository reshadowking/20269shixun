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
  /** 同 id、自身字段变了（不含 children——子树变化由各自的条目表达） */
  updated: Array<{ id: string; node: DesignNode }>
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
      diff.updated.push({ id, node: next.node })
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
  for (const u of diff.updated) store.updateNode(u.id, () => u.node)
  for (const add of diff.added) store.insertChild(add.parentId, add.node, add.index)
  // 顺序最后统一修：只有此时"整份 children 都在"（新增已插入、删除已生效），索引才与 after 对齐
  for (const o of diff.orders) store.reorderChildren(o.parentId, o.ids)
}

/**
 * 冲突可见化（2026-09-17）：AI 请求是**基于快照**的（发出去的 `before`），如果这期间
 * 队友改了**同一个节点**，这次差量落地会把队友那部分**静默覆盖**。
 *
 * 这里算出"被双方都碰过"的节点 id，供上层提示用户（例如："本次 AI 修改期间有人改过 2 个同一节点，
 * 已按 AI 结果覆盖，可 Ctrl+Z 撤回"）。**只报告不阻塞**：真正的权威合并要等服务端做 ops 级合并，
 * 现阶段让用户知情 + 可撤回，比静默覆盖可接受得多。
 */
export function overlappingIds(before: DesignNode, current: DesignNode, diff: DesignDiff): string[] {
  const b = flatten(before)
  const c = flatten(current)
  const touched = [
    ...diff.updated.map((u) => u.id),
    ...diff.removed,
    ...diff.moved.map((m) => m.id),
  ]
  const out: string[] = []
  for (const id of touched) {
    const prev = b.get(id)
    const now = c.get(id)
    if (!prev || !now) continue
    if (ownKey(prev.node) !== ownKey(now.node) || prev.parent !== now.parent) out.push(id)
  }
  return out
}
