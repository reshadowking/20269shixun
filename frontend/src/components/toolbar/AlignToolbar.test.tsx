/**
 * 对齐工具栏（2026-09-17 首次补组件测试）。
 *
 * free 布局下要先从 DOM 量节点尺寸再算对齐；此前测不到（hidden 节点不进 DOM /
 * 全局 querySelector 命中了别的层）就把宽高当 **0** —— 于是可见节点被对齐到错误位置。
 * 现在的口径与「转自由画布」一致：**测不全就整批不动**。
 */
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { DesignNode } from '@/design/types'
import { DesignStore } from '@/yjs/designStore'

import AlignToolbar from './AlignToolbar'

vi.mock('y-websocket', async () => ({
  WebsocketProvider: (await import('../../test/fakeYWebSocket')).FakeWebsocketProvider,
}))

function freeDesign(): DesignNode {
  return {
    id: 'root',
    type: 'frame',
    style: { layout: 'free', width: 800, height: 600 },
    children: [
      { id: 'a', type: 'frame', style: { width: 100, height: 40 }, x: 10, y: 10 },
      { id: 'b', type: 'frame', style: { width: 60, height: 40 }, x: 200, y: 100 },
    ],
  }
}

function mountDom(id: string, w: number, h: number) {
  const el = document.createElement('div')
  el.setAttribute('data-node-id', id)
  Object.defineProperty(el, 'offsetWidth', { value: w, configurable: true })
  Object.defineProperty(el, 'offsetHeight', { value: h, configurable: true })
  document.body.appendChild(el)
  return el
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('AlignToolbar（free 布局）', () => {
  it('测不到尺寸（节点不在 DOM）→ 整批不动，不拿 0 当尺寸', () => {
    const store = new DesignStore(undefined, freeDesign())
    const before = JSON.stringify(store.getDesign())
    render(<AlignToolbar design={store.getDesign()} selectedIds={new Set(['a', 'b'])} store={store} />)

    fireEvent.click(screen.getByTestId('align-right'))

    expect(JSON.stringify(store.getDesign()), '量不到就不该写任何坐标').toBe(before)
    store.destroy()
  })

  it('量到尺寸时正常右对齐（两个节点右边缘对齐到最右）', () => {
    const store = new DesignStore(undefined, freeDesign())
    mountDom('a', 100, 40)
    mountDom('b', 60, 40)
    render(<AlignToolbar design={store.getDesign()} selectedIds={new Set(['a', 'b'])} store={store} />)

    fireEvent.click(screen.getByTestId('align-right'))

    const kids = store.getDesign().children ?? []
    const a = kids.find((c) => c.id === 'a')!
    const b = kids.find((c) => c.id === 'b')!
    const rightA = (a.x ?? 0) + Number(a.style?.width ?? 0)
    const rightB = (b.x ?? 0) + Number(b.style?.width ?? 0)
    expect(rightA).toBe(rightB)
    store.destroy()
  })

  it('同一个 id 在 DOM 里出现多次（有别的投影层）→ 当作测不到，不动', () => {
    const store = new DesignStore(undefined, freeDesign())
    const before = JSON.stringify(store.getDesign())
    mountDom('a', 100, 40)
    mountDom('a', 100, 40) // 第二份投影
    mountDom('b', 60, 40)
    render(<AlignToolbar design={store.getDesign()} selectedIds={new Set(['a', 'b'])} store={store} />)

    fireEvent.click(screen.getByTestId('align-right'))

    expect(JSON.stringify(store.getDesign())).toBe(before)
    store.destroy()
  })
})
