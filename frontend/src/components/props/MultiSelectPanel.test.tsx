/**
 * 多选属性编辑测试（缺陷 1）：共有属性展示、批量修改、混合值、删除。
 */
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { DesignNode } from '@/design/types'
import { DesignStore } from '@/yjs/designStore'
import MultiSelectPanel from './MultiSelectPanel'

const DESIGN: DesignNode = {
  id: 'root',
  type: 'frame',
  style: { layout: 'column' },
  children: [
    { id: 'b1', type: 'component', componentType: 'button', props: { text: 'A' }, style: { width: 160, color: 'primary' } },
    { id: 'b2', type: 'component', componentType: 'button', props: { text: 'B' }, style: { width: 200, color: 'danger' } },
    { id: 't1', type: 'text', props: { text: '标题' }, style: { fontSize: 20 } },
  ],
}

function nodesOf(design: DesignNode, ids: string[]): DesignNode[] {
  const all = [design, ...(design.children ?? [])]
  return ids.map((id) => all.find((n) => n.id === id)!).filter(Boolean)
}

describe('MultiSelectPanel（P0-6 缺陷 1）', () => {
  it('展示共有属性（混合值显示空并提示）', () => {
    const store = new DesignStore(undefined, DESIGN)
    render(
      <MultiSelectPanel
        nodes={nodesOf(store.getDesign(), ['b1', 'b2'])}
        onUpdateMany={() => {}}
        onDeleteAll={() => {}}
      />,
    )
    // b1/b2 共有 width/color（不同值 → 混合占位）；fontSize 只有 t1 有 → 不显示
    expect(screen.getByTestId('multi-width')).toBeInTheDocument()
    expect(screen.getByTestId('multi-color')).toHaveAttribute('placeholder', '混合（点此输入统一值）')
    expect(screen.queryByTestId('multi-fontSize')).not.toBeInTheDocument()
    expect(screen.getByText('已选 2 个节点')).toBeInTheDocument()
  })

  it('修改共有属性应用到全部节点（单事务单撤销步）', () => {
    const store = new DesignStore(undefined, DESIGN)
    render(
      <MultiSelectPanel
        nodes={nodesOf(store.getDesign(), ['b1', 'b2'])}
        onUpdateMany={(u) => store.updateMany(['b1', 'b2'], u)}
        onDeleteAll={() => {}}
      />,
    )
    fireEvent.change(screen.getByTestId('multi-width'), { target: { value: '300' } })
    const children = store.getDesign().children ?? []
    expect(children[0].style?.width).toBe(300) // 数字字段转 number
    expect(children[1].style?.width).toBe(300)
    // 单撤销步：一次 undo 恢复两个
    expect(store.undo()).toBe(true)
    expect((store.getDesign().children ?? [])[0].style?.width).toBe(160)
    expect((store.getDesign().children ?? [])[1].style?.width).toBe(200)
  })

  it('删除全部选中', () => {
    const store = new DesignStore(undefined, DESIGN)
    const onDeleteAll = vi.fn(() => {
      ;['b1', 'b2'].forEach((id) => store.removeNode(id))
    })
    render(<MultiSelectPanel nodes={nodesOf(store.getDesign(), ['b1', 'b2'])} onUpdateMany={() => {}} onDeleteAll={onDeleteAll} />)
    fireEvent.click(screen.getByTestId('multi-delete-all'))
    expect(onDeleteAll).toHaveBeenCalled()
    const children = store.getDesign().children ?? []
    expect(children.map((c) => c.id)).toEqual(['t1'])
  })
})
