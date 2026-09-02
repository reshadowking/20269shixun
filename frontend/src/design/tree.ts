/**
 * DesignNode 树操作（纯函数，不可变更新）。
 * 阶段 1 供画布编辑使用；阶段 2 迁移 Yjs 时这些语义映射到 Y.Map/Y.Array transaction。
 * 必须保持纯函数 + 单测覆盖（核心逻辑不依赖 AI 生成，v2.2 §12）。
 */
import type { DesignNode } from './types'

/** 生成唯一 id（时间戳 + 随机段，够演示与协作用） */
export function genId(prefix = 'n'): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export function findNode(tree: DesignNode, id: string): DesignNode | null {
  if (tree.id === id) return tree
  for (const child of tree.children ?? []) {
    const hit = findNode(child, id)
    if (hit) return hit
  }
  return null
}

export function findParent(tree: DesignNode, id: string): DesignNode | null {
  for (const child of tree.children ?? []) {
    if (child.id === id) return tree
    const hit = findParent(child, id)
    if (hit) return hit
  }
  return null
}

/** 不可变更新：返回新树；未找到返回原树 */
export function updateNode(
  tree: DesignNode,
  id: string,
  updater: (node: DesignNode) => DesignNode,
): DesignNode {
  if (tree.id === id) return updater(tree)
  if (!tree.children?.length) return tree
  let changed = false
  const children = tree.children.map((c) => {
    const next = updateNode(c, id, updater)
    if (next !== c) changed = true
    return next
  })
  return changed ? { ...tree, children } : tree
}

/** 删除节点；返回新树或 null（根被删） */
export function removeNode(tree: DesignNode, id: string): DesignNode | null {
  if (tree.id === id) return null
  const children = tree.children ?? []
  let changed = false
  const next = children
    .map((c) => {
      if (c.id === id) {
        changed = true
        return null
      }
      const removed = removeNode(c, id)
      if (removed === null) {
        changed = true
        return null
      }
      if (removed !== c) changed = true // 子节点内部发生了删除
      return removed
    })
    .filter((c): c is DesignNode => c !== null)
  return changed ? { ...tree, children: next } : tree
}

/** 复制节点（整棵子树，重新生成所有 id；插入到父节点 children 末尾） */
export function duplicateNode(tree: DesignNode, id: string): DesignNode {
  const node = findNode(tree, id)
  if (!node) return tree
  const copy = cloneWithNewIds(node)
  if (tree.id === id) {
    // 复制根：包一层 frame 承载原树 + 副本
    return {
      id: genId('frame'),
      type: 'frame',
      style: { layout: 'column' },
      children: [tree, copy],
    }
  }
  const parent = findParent(tree, id)
  if (!parent) return tree
  return updateNode(tree, parent.id, (p) => ({
    ...p,
    children: [...(p.children ?? []), copy],
  }))
}

function cloneWithNewIds(node: DesignNode): DesignNode {
  return {
    ...node,
    id: genId(node.type === 'component' ? (node.componentType ?? 'comp') : node.type),
    children: node.children?.map(cloneWithNewIds),
  }
}

/** 把 child 从当前父节点移到 targetIndex 处（flex 布局拖拽重排的核心） */
export function moveChild(
  tree: DesignNode,
  childId: string,
  parentId: string,
  targetIndex: number,
): DesignNode {
  const parent = findNode(tree, parentId)
  if (!parent || !parent.children) return tree
  const siblings = parent.children
  const fromIndex = siblings.findIndex((c) => c.id === childId)
  if (fromIndex < 0) return tree
  const target = Math.max(0, Math.min(siblings.length - 1, targetIndex))
  if (fromIndex === target) return tree
  const reordered = [...siblings]
  const [moved] = reordered.splice(fromIndex, 1)
  reordered.splice(target, 0, moved)
  return updateNode(tree, parentId, (p) => ({ ...p, children: reordered }))
}

/** 收集全部节点 id（供选中/搜索） */
export function collectIds(tree: DesignNode, acc: string[] = []): string[] {
  acc.push(tree.id)
  for (const child of tree.children ?? []) collectIds(child, acc)
  return acc
}
