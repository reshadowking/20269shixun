/**
 * 设计树对比（P0-1 增量编辑）：返回被修改/新增/删除的节点 id 集合（画布高亮用）。
 * 比较规则：props/style 逐字段、x/y/hidden 按值；children 按 id 匹配（顺序变化不计为修改）。
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
    for (const nc of newNode.children ?? []) walk(oldById.get(nc.id), nc)
    for (const oc of oldNode.children ?? []) {
      if (!newById.has(oc.id)) walk(oc, undefined)
    }
  }

  walk(oldTree, newTree)
  return [...changed]
}
