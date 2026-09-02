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
    // 文本节点不是容器 → 无"插入子级"
    expect(screen.queryByTestId('layer-ctx-insert')).not.toBeInTheDocument()
  })

  it('容器节点右键含"插入子级"，点击后新增子节点', () => {
    const store = new DesignStore(undefined, DESIGN)
    renderTree(store)
    rightClickRow('card')
    expect(screen.getByTestId('layer-ctx-insert')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('layer-ctx-insert'))
    const children = store.getDesign().children?.find((c) => c.id === 'card')?.children ?? []
    expect(children.length).toBe(2)
    expect(children[1].type).toBe('text')
    expect(screen.queryByTestId('layer-context-menu')).not.toBeInTheDocument()
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
