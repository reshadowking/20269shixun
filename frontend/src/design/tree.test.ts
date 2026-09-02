import { describe, expect, it } from 'vitest'

import type { DesignNode } from './types'
import { collectIds, duplicateNode, findNode, findParent, genId, moveChild, removeNode, updateNode } from './tree'

function sampleTree(): DesignNode {
  return {
    id: 'root',
    type: 'frame',
    style: { layout: 'column' },
    children: [
      { id: 'a', type: 'text' },
      {
        id: 'b',
        type: 'frame',
        style: { layout: 'row' },
        children: [
          { id: 'b1', type: 'text' },
          { id: 'b2', type: 'text' },
        ],
      },
      { id: 'c', type: 'text' },
    ],
  }
}

describe('genId', () => {
  it('生成唯一 id', () => {
    const a = genId()
    const b = genId()
    expect(a).not.toBe(b)
    expect(genId('comp')).toMatch(/^comp-/)
  })
})

describe('findNode / findParent / collectIds', () => {
  const tree = sampleTree()
  it('查找深层节点', () => {
    expect(findNode(tree, 'b2')?.id).toBe('b2')
    expect(findNode(tree, 'nope')).toBeNull()
  })
  it('查找父节点', () => {
    expect(findParent(tree, 'b2')?.id).toBe('b')
    expect(findParent(tree, 'b')?.id).toBe('root')
    expect(findParent(tree, 'root')).toBeNull()
  })
  it('收集全部 id', () => {
    expect(collectIds(tree)).toEqual(['root', 'a', 'b', 'b1', 'b2', 'c'])
  })
})

describe('updateNode', () => {
  it('不可变更新深层节点', () => {
    const tree = sampleTree()
    const next = updateNode(tree, 'b2', (n) => ({ ...n, props: { text: 'x' } }))
    expect(findNode(next, 'b2')?.props?.text).toBe('x')
    expect(findNode(tree, 'b2')?.props).toBeUndefined() // 原树不变
    expect(next).not.toBe(tree)
  })
  it('未找到返回原树', () => {
    const tree = sampleTree()
    expect(updateNode(tree, 'nope', (n) => n)).toBe(tree)
  })
})

describe('removeNode', () => {
  it('删除深层节点', () => {
    const tree = sampleTree()
    const next = removeNode(tree, 'b1')!
    expect(findNode(next, 'b1')).toBeNull()
    expect(findNode(next, 'b')).not.toBeNull()
  })
  it('删除根返回 null', () => {
    expect(removeNode(sampleTree(), 'root')).toBeNull()
  })
})

describe('duplicateNode', () => {
  it('复制子树：原节点保留，副本插入末尾且 id 全部重新生成', () => {
    const tree = sampleTree()
    const next = duplicateNode(tree, 'b')
    const ids = collectIds(next)
    expect(findNode(next, 'b')).not.toBeNull()       // 原节点保留
    expect(ids.filter((id) => id.startsWith('frame-')).length).toBe(1) // 副本（b 的 type 是 frame）
    expect(ids.filter((id) => id.startsWith('text-')).length).toBe(2)  // b1/b2 副本
    expect(new Set(ids).size).toBe(ids.length)        // 全部唯一
  })

  it('复制根：包一层 frame', () => {
    const tree = sampleTree()
    const next = duplicateNode(tree, 'root')
    expect(next.type).toBe('frame')
    expect(next.children?.length).toBe(2)
    expect(next.id).not.toBe('root')
    expect(collectIds(next).filter((id) => id === 'root').length).toBe(1)
  })
})

describe('moveChild', () => {
  it('同层重排', () => {
    const tree = sampleTree()
    const next = moveChild(tree, 'c', 'root', 0)
    expect(next.children?.map((c) => c.id)).toEqual(['c', 'a', 'b'])
  })
  it('索引越界钳制', () => {
    const tree = sampleTree()
    const next = moveChild(tree, 'a', 'root', 99)
    expect(next.children?.map((c) => c.id)).toEqual(['b', 'c', 'a'])
    const same = moveChild(tree, 'a', 'root', 0)
    expect(same).toBe(tree)
  })
  it('跨层级移动需显式 parentId（此处不实现）', () => {
    const tree = sampleTree()
    const next = moveChild(tree, 'b2', 'root', 0) // b2 不在 root 下 → 原树
    expect(next).toBe(tree)
  })
})
