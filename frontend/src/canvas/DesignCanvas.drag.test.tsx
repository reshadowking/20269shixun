/**
 * T46a-3e：只读访客的**拖拽路径**——3e 里唯一没有被自动化覆盖的一条
 * （验收方在浏览器里也没法可靠地做真拖拽）。
 *
 * 这里用指针事件直接驱动：拖拽最终会写 `store.updateNode`（free 布局）或 `moveChild`（flex 重排），
 * 断言的重点是**只读时根本不进入拖拽**（而不是"进入了再被写入层拒绝"），同时**选中仍然可用**。
 * jsdom 没有真实布局：容器的 getBoundingClientRect 全 0、默认视图 scale=1，所以位移换算就是像素差。
 */
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { DesignNode } from '@/design/types'
import { DesignStore } from '@/yjs/designStore'

import DesignCanvas from './DesignCanvas'

function freeDesign(): DesignNode {
  return {
    id: 'root',
    type: 'frame',
    style: { layout: 'free', width: 800, height: 600 },
    children: [
      { id: 'a', type: 'component', componentType: 'card', x: 10, y: 10, style: { width: 200, height: 100 } },
    ],
  }
}

/** 拖一次：在节点上按下 → 容器上移动 30px → 抬起 */
function dragBy30() {
  const node = screen.getByTestId('node-a')
  const container = screen.getByTestId('design-canvas')
  fireEvent.pointerDown(node, { clientX: 0, clientY: 0 })
  fireEvent.pointerMove(container, { clientX: 30, clientY: 0 })
  fireEvent.pointerUp(container, { clientX: 30, clientY: 0 })
}

function renderCanvas(readOnly: boolean) {
  const store = new DesignStore(undefined, freeDesign())
  const onSelectionChange = vi.fn()
  const onReadOnlyDragAttempt = vi.fn()
  const blocked: string[] = []
  store.subscribeBlocked((reason) => blocked.push(reason))
  render(
    <DesignCanvas
      design={store.getDesign()}
      store={store}
      selectedIds={new Set()}
      onSelectionChange={onSelectionChange}
      readOnly={readOnly}
      onReadOnlyDragAttempt={onReadOnlyDragAttempt}
    />,
  )
  return { store, onSelectionChange, blocked, onReadOnlyDragAttempt }
}

describe('DesignCanvas 拖拽（T46a-3e 只读）', () => {
  beforeEach(() => {
    // 画布重居中用 ResizeObserver，jsdom 没有：给个最小桩（与页面级用例一致）
    class RO {
      observe = vi.fn()
      unobserve = vi.fn()
      disconnect = vi.fn()
    }
    vi.stubGlobal('ResizeObserver', RO)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('可编辑：拖拽真的移动了节点（对照组，证明这套事件驱动有效）', () => {
    const { store } = renderCanvas(false)
    dragBy30()
    expect(store.getDesign().children?.[0].x).toBe(40)
  })

  it('只读访客：拖拽不进入拖拽流程（位置不变），但仍可选中查看', () => {
    const { store, onSelectionChange, blocked, onReadOnlyDragAttempt } = renderCanvas(true)
    dragBy30()

    // 节点没动：只读时压根没开始拖拽
    const node = store.getDesign().children?.[0]
    expect(node?.x).toBe(10)
    expect(node?.y).toBe(10)
    // 选中（只读也能看属性）仍然生效
    expect(onSelectionChange).toHaveBeenCalled()
    const selected = onSelectionChange.mock.calls.at(-1)?.[0] as Set<string>
    expect([...selected]).toEqual(['a'])
    // 不是"先拖再被写入层拒绝"——没有产生 blocked 事件
    expect(blocked).toEqual([])
    // 但必须给一次明确反馈：否则"拖了没反应"与卡顿无从区分
    expect(onReadOnlyDragAttempt).toHaveBeenCalledTimes(1)
    store.destroy()
  })

  it('零位移的点击（<4px）不触发只读提示——单纯点选不该报"不能拖"', () => {
    const { onReadOnlyDragAttempt } = renderCanvas(true)
    const node = screen.getByTestId('node-a')
    const container = screen.getByTestId('design-canvas')
    fireEvent.pointerDown(node, { clientX: 0, clientY: 0 })
    fireEvent.pointerMove(container, { clientX: 2, clientY: 1 })
    fireEvent.pointerUp(container, { clientX: 2, clientY: 1 })
    expect(onReadOnlyDragAttempt).not.toHaveBeenCalled()
  })

  it('可编辑时不触发只读提示（提示只属于只读路径）', () => {
    const { onReadOnlyDragAttempt } = renderCanvas(false)
    dragBy30()
    expect(onReadOnlyDragAttempt).not.toHaveBeenCalled()
  })
})
