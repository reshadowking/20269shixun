/**
 * 撤销的并发口径（2026-09-16 按实测收窄）：
 * ① 无冲突：照常撤销；
 * ② 属性步骤被队友覆盖 → **跳过 + 告知**（Yjs 的撤销在这种情况会静默失效，实测按钮被消耗却什么也没变）；
 * ③ 结构性步骤涉及的节点之后被队友改过 → **先确认**（撤销会连队友的改动一起撤掉，不可逆）；
 * ④ 节点级作用域：队友改的是别的节点 → 既不提示也不弹框（避免噪声，用户会训练成无脑点确定）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { FakeWebsocketProvider } from '../test/fakeYWebSocket'
import { DesignStore } from './designStore'
import type { DesignNode } from '@/design/types'

vi.mock('y-websocket', async () => ({
  WebsocketProvider: (await import('../test/fakeYWebSocket')).FakeWebsocketProvider,
}))

function design(): DesignNode {
  return {
    id: 'root',
    type: 'frame',
    style: { layout: 'column' },
    children: [
      { id: 'a', type: 'text', props: { text: '原文' }, style: {} },
      { id: 'b', type: 'text', props: { text: '乙的节点' }, style: {} },
    ],
  }
}

function makeStore() {
  const store = new DesignStore('ws://fake:1234', design(), 'room-undo')
  store.connectProvider()
  const blocked = vi.fn((_reason: string) => undefined)
  const confirmFn = vi.fn((_reason: string) => true)
  store.onUndoBlocked = blocked
  store.onUndoConfirm = confirmFn
  return { store, blocked, confirmFn }
}

const textOf = (store: DesignStore, id: string) => store.getDesign().children?.find((c) => c.id === id)?.props?.text

describe('撤销的并发口径', () => {
  beforeEach(() => {
    FakeWebsocketProvider.reset()
  })

  it('① 无冲突：甲独改 → 撤销回到原值（不能回归）', () => {
    const { store, blocked, confirmFn } = makeStore()
    store.updateNode('a', (n) => ({ ...n, props: { ...n.props, text: '甲改的' } }))
    expect(textOf(store, 'a')).toBe('甲改的')
    expect(store.undo()).toBe(true)
    expect(textOf(store, 'a')).toBe('原文')
    expect(blocked).not.toHaveBeenCalled()
    expect(confirmFn).not.toHaveBeenCalled()
    store.destroy()
  })

  it('② 属性被队友覆盖：跳过该步并告知（栈不前进），值保持队友的', () => {
    const { store, blocked, confirmFn } = makeStore()
    store.updateNode('a', (n) => ({ ...n, props: { ...n.props, text: '甲改的' } }))
    store.__applyRemoteForTests('a', (n) => ({ ...n, props: { ...n.props, text: '乙改的' } }))

    expect(store.undo()).toBe(false) // 没有执行撤销
    expect(textOf(store, 'a')).toBe('乙改的') // 队友的值保住
    expect(blocked).toHaveBeenCalledTimes(1)
    expect(String(blocked.mock.calls[0][0])).toContain('已被队友的修改覆盖')
    expect(confirmFn).not.toHaveBeenCalled() // 这条不弹框（弹了就是噪声）
    expect(store.canUndo).toBe(false) // 该步已丢弃（再按 Ctrl+Z 不会卡在同一个死步骤上）
    store.destroy()
  })

  it('③ 结构性步骤被队友改过：先确认；取消则不撤且节点还在', () => {
    const { store, confirmFn } = makeStore()
    store.insertChild('root', { id: 'card-1', type: 'component', componentType: 'card', props: { text: '卡片' } })
    store.__applyRemoteForTests('card-1', (n) => ({ ...n, props: { ...n.props, text: '乙在新节点写的' } }))

    confirmFn.mockReturnValueOnce(false) // 用户点了取消
    expect(store.undo()).toBe(false)
    expect(confirmFn).toHaveBeenCalledTimes(1)
    expect(String(confirmFn.mock.calls[0][0])).toContain('队友')
    expect(store.getDesign().children?.some((c) => c.id === 'card-1')).toBe(true)
    expect(store.canUndo).toBe(true) // 栈保留：下次再问

    expect(store.undo()).toBe(true) // 这次确定
    expect(store.getDesign().children?.some((c) => c.id === 'card-1')).toBe(false)
    store.destroy()
  })

  it('④ 噪声检查（节点级作用域）：队友改别的节点 → 不提示、不弹框', () => {
    const { store, blocked, confirmFn } = makeStore()
    store.__applyRemoteForTests('a', (n) => ({ ...n, props: { ...n.props, text: '乙改 a' } }))
    store.updateNode('b', (n) => ({ ...n, props: { ...n.props, text: '甲改 b' } }))

    expect(store.undo()).toBe(true)
    expect(textOf(store, 'b')).toBe('乙的节点')
    expect(blocked).not.toHaveBeenCalled()
    expect(confirmFn).not.toHaveBeenCalled()
    store.destroy()
  })

  it('⑤ 结构性步骤但队友没碰过 → 直接撤，不打扰用户', () => {
    const { store, confirmFn } = makeStore()
    store.insertChild('root', { id: 'card-2', type: 'component', componentType: 'card' })
    expect(store.undo()).toBe(true)
    expect(store.getDesign().children?.some((c) => c.id === 'card-2')).toBe(false)
    expect(confirmFn).not.toHaveBeenCalled()
    store.destroy()
  })
})
