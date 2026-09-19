/**
 * 右侧面板拖拽手柄（T49）。
 *
 * 行为约定（与实现一一对应）：
 * - 面板在右侧：向左拖 = 变宽；
 * - `pointermove` 阶段**不落盘**，`pointerup` 才写 storage；
 * - 双击复位到默认宽度；方向键微调（无障碍）；
 * - 任何情况下宽度都被夹在合法区间内。
 */
import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'

import PanelResizeHandle from './PanelResizeHandle'
import { PANEL_WIDTH_DEFAULT, PANEL_WIDTH_KEY, PANEL_WIDTH_MIN, readPanelWidth } from '@/lib/panelWidth'
import { readStorage } from '@/lib/storage'

/** 最小宿主：把 onWidthChange 接到 state，便于断言渲染出的宽度 */
function Harness({ initial = PANEL_WIDTH_DEFAULT }: { initial?: number }) {
  const [width, setWidth] = useState(initial)
  return (
    <div>
      <PanelResizeHandle width={width} onWidthChange={setWidth} />
      <span data-testid="width">{width}</span>
    </div>
  )
}

function drag(handle: HTMLElement, fromX: number, toX: number) {
  fireEvent.pointerDown(handle, { clientX: fromX, pointerId: 1 })
  fireEvent.pointerMove(handle, { clientX: toX, pointerId: 1 })
  fireEvent.pointerUp(handle, { clientX: toX, pointerId: 1 })
}

describe('PanelResizeHandle', () => {
  it('无障碍语义齐备（可聚焦的分隔条）', () => {
    render(<Harness />)
    const handle = screen.getByTestId('panel-resize-handle')
    expect(handle).toHaveAttribute('role', 'separator')
    expect(handle).toHaveAttribute('aria-orientation', 'vertical')
    expect(handle).toHaveAttribute('aria-valuenow', String(PANEL_WIDTH_DEFAULT))
    expect(handle.className).toContain('cursor-col-resize')
  })

  it('向左拖 → 变宽（面板在右侧）', () => {
    render(<Harness />)
    drag(screen.getByTestId('panel-resize-handle'), 800, 700)
    expect(screen.getByTestId('width')).toHaveTextContent('420')
  })

  it('向右拖 → 变窄，且夹在下界', () => {
    render(<Harness />)
    drag(screen.getByTestId('panel-resize-handle'), 400, 2000)
    expect(screen.getByTestId('width')).toHaveTextContent(String(PANEL_WIDTH_MIN))
  })

  it('**拖拽过程中不落盘**，pointerup 才写 storage', () => {
    render(<Harness />)
    const handle = screen.getByTestId('panel-resize-handle')
    fireEvent.pointerDown(handle, { clientX: 800, pointerId: 1 })
    fireEvent.pointerMove(handle, { clientX: 700, pointerId: 1 })
    expect(readStorage(PANEL_WIDTH_KEY)).toBeNull() // 移动阶段：内存里有，磁盘上没有
    fireEvent.pointerUp(handle, { clientX: 700, pointerId: 1 })
    expect(readStorage(PANEL_WIDTH_KEY)).toBe('420')
    expect(readPanelWidth(window.innerWidth)).toBe(420)
  })

  it('双击复位到默认宽度（并落盘）', () => {
    render(<Harness initial={520} />)
    fireEvent.doubleClick(screen.getByTestId('panel-resize-handle'))
    expect(screen.getByTestId('width')).toHaveTextContent(String(PANEL_WIDTH_DEFAULT))
    expect(readStorage(PANEL_WIDTH_KEY)).toBe(String(PANEL_WIDTH_DEFAULT))
  })

  it('方向键微调（左加右减）', () => {
    render(<Harness />)
    const handle = screen.getByTestId('panel-resize-handle')
    fireEvent.keyDown(handle, { key: 'ArrowLeft' })
    expect(screen.getByTestId('width')).toHaveTextContent('344')
    fireEvent.keyDown(handle, { key: 'ArrowRight' })
    expect(screen.getByTestId('width')).toHaveTextContent('320')
  })

  it('未开始拖拽时移动指针不改变宽度', () => {
    render(<Harness />)
    fireEvent.pointerMove(screen.getByTestId('panel-resize-handle'), { clientX: 100, pointerId: 1 })
    expect(screen.getByTestId('width')).toHaveTextContent(String(PANEL_WIDTH_DEFAULT))
  })
})
