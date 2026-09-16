/**
 * 光标级 presence（DesignCanvas）：
 * - 画布内移动指针 → 按**世界坐标**广播（平移/缩放都要换算对）；
 * - 队友光标按世界坐标绘制在世界层里（跟着画布一起平移缩放）；
 * - 指针移出画布 → 清掉自己的光标（队友不会看到"幽灵"停在原地）。
 */
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { DesignNode } from '@/design/types'
import { DesignStore } from '@/yjs/designStore'

import { FakeWebsocketProvider } from '../test/fakeYWebSocket'

import DesignCanvas from './DesignCanvas'

vi.mock('y-websocket', async () => ({
  WebsocketProvider: (await import('../test/fakeYWebSocket')).FakeWebsocketProvider,
}))

const DESIGN: DesignNode = {
  id: 'root',
  type: 'frame',
  style: { layout: 'column', width: 800, height: 600 },
  children: [{ id: 'a', type: 'text', props: { text: '标题' }, style: {} }],
}

function setup(states: Map<number, unknown> = new Map()) {
  FakeWebsocketProvider.reset()
  const store = new DesignStore('ws://fake:1234', DESIGN, 'room-cursor')
  store.connectProvider()
  const provider = store.provider as unknown as FakeWebsocketProvider
  provider.awareness.clientID = 1
  provider.awareness.getStates = vi.fn(() => states as never)
  render(
    <DesignCanvas
      design={store.getDesign()}
      store={store}
      selectedIds={new Set()}
      onSelectionChange={vi.fn()}
    />,
  )
  return { store, provider }
}

describe('DesignCanvas 光标 presence', () => {
  beforeEach(() => {
    class RO {
      observe = vi.fn()
      unobserve = vi.fn()
      disconnect = vi.fn()
    }
    vi.stubGlobal('ResizeObserver', RO)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('指针在画布内移动：按世界坐标广播（容器 rect 全 0、scale=1 → 屏幕坐标即世界坐标）', () => {
    const { store, provider } = setup()
    fireEvent.pointerMove(screen.getByTestId('design-canvas'), { clientX: 140, clientY: 90 })
    expect(provider.awareness.setLocalStateField).toHaveBeenCalledWith('cursor', { x: 140, y: 90 })
    store.destroy()
  })

  it('指针移出画布：立刻清空自己的光标（不让队友看到幽灵光标）', () => {
    const { store, provider } = setup()
    fireEvent.pointerLeave(screen.getByTestId('design-canvas'))
    expect(provider.awareness.setLocalStateField).toHaveBeenLastCalledWith('cursor', null)
    store.destroy()
  })

  it('队友光标画在世界层：位置=世界坐标、带昵称与颜色；自己与无 cursor 的状态不画', () => {
    const states = new Map([
      [1, { user: { name: '我' }, cursor: { x: 1, y: 1 } }],
      [42, { user: { name: '小张' }, cursor: { x: 220, y: 130 } }],
      [43, { user: { name: '没光标' } }],
    ])
    const { store } = setup(states)

    const cursor = screen.getByTestId('cursor-42')
    expect(cursor).toHaveStyle({ left: '220px', top: '130px' })
    expect(cursor).toHaveTextContent('小张')
    expect(screen.queryByTestId('cursor-1')).not.toBeInTheDocument() // 自己
    expect(screen.queryByTestId('cursor-43')).not.toBeInTheDocument() // 无 cursor
    store.destroy()
  })
})
