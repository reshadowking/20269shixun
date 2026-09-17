/**
 * 设计树对比（P0-1 增量编辑）：返回被修改/新增/删除的节点 id 集合（画布高亮用）。
 * 比较规则：props/style 逐字段、x/y/hidden 按值；children 按 id 匹配。
 * 2026-09-17 修：**同父级的相对顺序变化要算改动**——原来"顺序变化不计为修改"，
 * 于是"把某个模块挪到最上面"（后端 ops 真的改了顺序）在前端被判定为"没有需要改动的地方"。
 * 只看"两棵树都还在的孩子"的相对顺序：纯新增/删除造成的位移不算重排。
 */
import type { DesignNode } from '@/design/types'

function nodeChanged(a: DesignNode, b: DesignNode): boolean {
  return (
    JSON.stringify(a.props ?? {}) !== JSON.stringify(b.props ?? {}) ||
    JSON.stringify(a.style ?? {}) !== JSON.stringify(b.style ?? {}) ||
    a.x !== b.x ||
    a.y !== b.y ||
    a.hidden !== b.hidden
  )
}

export function diffDesign(oldTree: DesignNode, newTree: DesignNode): string[] {
  const changed = new Set<string>()

  const collectSubtree = (node: DesignNode) => {
    changed.add(node.id)
    node.children?.forEach(collectSubtree)
  }

  const walk = (oldNode: DesignNode | undefined, newNode: DesignNode | undefined) => {
    if (!oldNode && newNode) {
      collectSubtree(newNode) // 新增
      return
    }
    if (oldNode && !newNode) {
      changed.add(oldNode.id) // 删除
      return
    }
    if (!oldNode || !newNode) return
    if (nodeChanged(oldNode, newNode)) changed.add(newNode.id)
    const oldById = new Map((oldNode.children ?? []).map((c) => [c.id, c]))
    const newById = new Map((newNode.children ?? []).map((c) => [c.id, c]))
    const oldIds = (oldNode.children ?? []).map((c) => c.id)
    const newIds = (newNode.children ?? []).map((c) => c.id)
    const oldCommon = oldIds.filter((id) => newById.has(id))
    const newCommon = newIds.filter((id) => oldById.has(id))
    if (oldCommon.join(',') !== newCommon.join(',')) changed.add(newNode.id)
    for (const nc of newNode.children ?? []) walk(oldById.get(nc.id), nc)
    for (const oc of oldNode.children ?? []) {
      if (!newById.has(oc.id)) walk(oc, undefined)
    }
  }

  walk(oldTree, newTree)
  return [...changed]
}
