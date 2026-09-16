/**
 * 光标级 presence（2026-09-16）：把"谁在线"升级为"谁在哪"。
 * - 本地光标写进 awareness 的 `cursor` 字段，按 60ms 节流；离开画布（null）**不节流**，立即清掉；
 * - 队友光标读回来后要排除自己、跳过没带 cursor 的状态。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { FakeWebsocketProvider } from '../test/fakeYWebSocket'
import { DesignStore } from './designStore'
import type { DesignNode } from '@/design/types'

vi.mock('y-websocket', async () => ({
  WebsocketProvider: (await import('../test/fakeYWebSocket')).FakeWebsocketProvider,
}))

const DESIGN: DesignNode = { id: 'root', type: 'frame', children: [] }

function connectedStore() {
  const store = new DesignStore('ws://fake:1234', DESIGN, 'room-cursor')
  store.connectProvider()
  const provider = store.provider as unknown as FakeWebsocketProvider
  return { store, provider }
}

describe('光标 presence（DesignStore）', () => {
  beforeEach(() => {
    FakeWebsocketProvider.reset()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('本地光标写入 awareness（节流 60ms），离开画布立即清空', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-16T10:00:00Z'))
    const { store, provider } = connectedStore()

    store.publishCursor({ x: 10, y: 20 })
    expect(provider.awareness.setLocalStateField).toHaveBeenLastCalledWith('cursor', { x: 10, y: 20 })

    // 节流窗口内：不再写
    const calls = provider.awareness.setLocalStateField.mock.calls.length
    store.publishCursor({ x: 11, y: 21 })
    expect(provider.awareness.setLocalStateField.mock.calls.length).toBe(calls)

    // 过窗口：继续写
    vi.setSystemTime(new Date('2026-09-16T10:00:01Z'))
    store.publishCursor({ x: 12, y: 22 })
    expect(provider.awareness.setLocalStateField).toHaveBeenLastCalledWith('cursor', { x: 12, y: 22 })

    // 离开画布：不受节流限制，立刻清
    store.publishCursor(null)
    expect(provider.awareness.setLocalStateField).toHaveBeenLastCalledWith('cursor', null)
    store.destroy()
  })

  it('没有 provider（本地模式）时静默跳过，不抛错', () => {
    const store = new DesignStore(undefined, DESIGN, 'room-local')
    expect(() => store.publishCursor({ x: 1, y: 2 })).not.toThrow()
    expect(store.remoteCursors).toEqual([])
    store.destroy()
  })

  it('队友光标：排除自己、跳过缺 cursor 的状态、带上稳定颜色', () => {
    const { store, provider } = connectedStore()
    provider.awareness.clientID = 1 // 自己
    provider.awareness.getStates = vi.fn(
      () =>
        new Map([
          [1, { user: { name: '我' }, cursor: { x: 1, y: 1 } }], // 自己 → 不画
          [7, { user: { name: '小张' }, cursor: { x: 120, y: 80 } }],
          [9, { user: { name: '只有昵称' } }], // 没 cursor → 跳过
          [11, { cursor: { x: 5, y: 6 } }], // 没昵称 → 用"队友"占位
        ]) as never,
    )

    const cursors = store.remoteCursors
    expect(cursors.map((c) => c.clientId)).toEqual([7, 11])
    expect(cursors[0]).toMatchObject({ name: '小张', x: 120, y: 80 })
    expect(cursors[0].color).toMatch(/^hsl\(/)
    expect(cursors[1].name).toBe('队友')
    // 颜色由 clientId 决定：同一队友颜色稳定
    expect(store.remoteCursors[0].color).toBe(cursors[0].color)
    store.destroy()
  })
})
