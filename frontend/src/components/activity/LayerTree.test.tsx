/**
 * 图层树右键菜单测试（缺陷 7）：右键出现菜单，复制/删除/插入子级生效。
 */
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { DesignNode } from '@/design/types'
import { DesignStore } from '@/yjs/designStore'
import LayerTree from './LayerTree'

const DESIGN: DesignNode = {
  id: 'root',
  type: 'frame',
  style: { layout: 'column' },
  children: [
    { id: 'title', type: 'text', props: { text: '标题' } },
    { id: 'card', type: 'frame', style: { layout: 'row' }, children: [{ id: 'btn', type: 'component', componentType: 'button', props: { text: '按钮' } }] },
  ],
}

function renderTree(store: DesignStore) {
  return render(
    <LayerTree
      design={store.getDesign()}
      selectedIds={new Set()}
      onSelect={() => {}}
      store={store}
    />,
  )
}

function rightClickRow(nodeId: string) {
  fireEvent.contextMenu(screen.getByTestId(`layer-${nodeId}`))
}

describe('LayerTree 右键菜单（P0-5）', () => {
  it('右键弹出菜单（复制/重命名/删除/插入子级）', () => {
    const store = new DesignStore(undefined, DESIGN)
    renderTree(store)
    rightClickRow('title')
    expect(screen.getByTestId('layer-context-menu')).toBeInTheDocument()
    expect(screen.getByTestId('layer-ctx-duplicate')).toBeInTheDocument()
    expect(screen.getByTestId('layer-ctx-rename')).toBeInTheDocument()
    expect(screen.getByTestId('layer-ctx-delete')).toBeInTheDocument()
    // 文本节点不是容器 → 无任何插入项
    expect(screen.queryByTestId('layer-ctx-insert-text')).not.toBeInTheDocument()
    expect(screen.queryByTestId('layer-ctx-insert-rect')).not.toBeInTheDocument()
    expect(screen.queryByTestId('layer-ctx-insert-frame')).not.toBeInTheDocument()
  })

  it('容器节点右键含三个插入项，点击"插入文本"新增 text 子节点', () => {
    const store = new DesignStore(undefined, DESIGN)
    renderTree(store)
    rightClickRow('card')
    expect(screen.getByTestId('layer-ctx-insert-text')).toBeInTheDocument()
    expect(screen.getByTestId('layer-ctx-insert-rect')).toBeInTheDocument()
    expect(screen.getByTestId('layer-ctx-insert-frame')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('layer-ctx-insert-text'))
    const children = store.getDesign().children?.find((c) => c.id === 'card')?.children ?? []
    expect(children.length).toBe(2)
    expect(children[1].type).toBe('text')
    expect(screen.queryByTestId('layer-context-menu')).not.toBeInTheDocument()
  })

  it('插入色块/容器：落入该容器 children 末尾（与组件库面板同一工厂）', () => {
    const store = new DesignStore(undefined, DESIGN)
    renderTree(store)
    rightClickRow('card')
    fireEvent.click(screen.getByTestId('layer-ctx-insert-rect'))
    rightClickRow('card')
    fireEvent.click(screen.getByTestId('layer-ctx-insert-frame'))
    const children = store.getDesign().children?.find((c) => c.id === 'card')?.children ?? []
    expect(children.map((c) => c.type)).toEqual(['component', 'rect', 'frame'])
    // 默认值与面板一致：容器带布局语义、色块带令牌背景
    expect(children[2].style).toMatchObject({ layout: 'column', background: '#FFFFFF' })
    expect(children[1].style).toMatchObject({ background: 'primary' })
  })

  it('复制节点生成新 id 节点', () => {
    const store = new DesignStore(undefined, DESIGN)
    renderTree(store)
    rightClickRow('btn')
    fireEvent.click(screen.getByTestId('layer-ctx-duplicate'))
    const btnChildren = store.getDesign().children?.find((c) => c.id === 'card')?.children ?? []
    expect(btnChildren.length).toBe(2)
    expect(btnChildren[1].id).not.toBe('btn')
  })

  it('删除节点生效', () => {
    const store = new DesignStore(undefined, DESIGN)
    renderTree(store)
    rightClickRow('title')
    fireEvent.click(screen.getByTestId('layer-ctx-delete'))
    const children = store.getDesign().children ?? []
    expect(children.map((c) => c.id)).toEqual(['card'])
  })

  it('重命名进入编辑态', () => {
    const store = new DesignStore(undefined, DESIGN)
    renderTree(store)
    rightClickRow('title')
    fireEvent.click(screen.getByTestId('layer-ctx-rename'))
    // 进入重命名输入框
   expect(screen.getByTestId('layer-rename-input-title')).toBeInTheDocument()
  })
})

/**
 * 拖拽落点（2026-09-17 首次补测试）。
 *
 * 修前两处"拖了没反应，但目标行仍然高亮"：
 * ① 跨父级拖到**叶子**节点 → `handleDrop` 只在同父时处理，跨父直接什么都不做；
 * ② 拖到**空容器** → 旧判据要求"目标已有 children"，空容器被当成叶子。
 */
describe('LayerTree 拖拽落点', () => {
  const TREE: DesignNode = {
    id: 'root',
    type: 'frame',
    style: { layout: 'column' },
    children: [
      { id: 'title', type: 'text', props: { text: '标题' } },
      { id: 'empty', type: 'frame', style: { layout: 'column' } },
      {
        id: 'card',
        type: 'frame',
        style: { layout: 'row' },
        children: [{ id: 'btn', type: 'component', componentType: 'button', props: { text: '按钮' } }],
      },
    ],
  }

  function dragDrop(sourceId: string, targetId: string) {
    const dataTransfer = { getData: () => sourceId, setData: () => {}, effectAllowed: 'move' }
    fireEvent.dragStart(screen.getByTestId(`layer-${sourceId}`), { dataTransfer })
    fireEvent.dragOver(screen.getByTestId(`layer-${targetId}`), { dataTransfer })
    fireEvent.drop(screen.getByTestId(`layer-${targetId}`), { dataTransfer })
  }

  function ids(store: DesignStore, parentId: string): string[] {
    const find = (n: DesignNode): DesignNode | undefined =>
      n.id === parentId ? n : (n.children ?? []).map(find).find(Boolean)
    return (find(store.getDesign())?.children ?? []).map((c) => c.id)
  }

  it('跨父级拖到叶子节点：移到目标所在父级的同一位置（旧实现静默无操作）', () => {
    const store = new DesignStore(undefined, TREE)
    renderTree(store)

    dragDrop('btn', 'title') // btn 在 card 里 → 拖到 root 的叶子 title 上

    expect(ids(store, 'root')).toEqual(['btn', 'title', 'empty', 'card'])
    expect(ids(store, 'card')).toEqual([])
  })

  it('拖到空容器：移入该容器（旧实现把空容器当叶子，进不去）', () => {
    const store = new DesignStore(undefined, TREE)
    renderTree(store)

    dragDrop('title', 'empty')

    expect(ids(store, 'empty')).toEqual(['title'])
    expect(ids(store, 'root')).toEqual(['empty', 'card'])
  })

  it('同父级重排仍然生效（回归）', () => {
    const store = new DesignStore(undefined, TREE)
    renderTree(store)

    dragDrop('card', 'title') // 同父（root）：插到 title 的位置

    expect(ids(store, 'root')).toEqual(['card', 'title', 'empty'])
  })
})
