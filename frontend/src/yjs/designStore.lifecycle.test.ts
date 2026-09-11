/**
 * T2 presence 连接泄漏回归：provider 的建立/断开生命周期。
 * 修复前：constructor 建 WebsocketProvider、全项目无人销毁 → 卸载后 socket 残留，
 * awareness 每 ~15s 续期，服务端永远认为该 client 在线（在线人数虚增）。
 * 修复后：constructor 只记忆端点；connectProvider/disconnectProvider 与 React
 * effect 配对（StrictMode mount→cleanup→mount = 断开→重连，ydoc/撤销栈不受影响）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { FakeWebsocketProvider } from '../test/fakeYWebSocket'
import { DesignStore } from './designStore'
import type { DesignNode } from '@/design/types'

vi.mock('y-websocket', async () => ({
  WebsocketProvider: (await import('../test/fakeYWebSocket')).FakeWebsocketProvider,
}))

function sample(): DesignNode {
  return {
    id: 'root',
    type: 'frame',
    style: { layout: 'column', gap: 8 },
    children: [{ id: 'a', type: 'text', props: { text: '标题' } }],
  }
}

describe('T2 DesignStore provider 生命周期', () => {
  beforeEach(() => {
    FakeWebsocketProvider.reset()
  })

  it('构造时只记忆端点，不建立连接（连接时机归 React effect）', () => {
    const store = new DesignStore('ws://test:1234', sample(), 'room-a')
    expect(store.provider).toBeNull()
    expect(FakeWebsocketProvider.instances).toHaveLength(0)
  })

  it('connectProvider 建立 provider 并绑定同一 ydoc；重复调用幂等', () => {
    const store = new DesignStore('ws://test:1234', sample(), 'room-a')
    store.connectProvider()
    expect(store.provider).toBe(FakeWebsocketProvider.instances[0])
    expect(FakeWebsocketProvider.instances[0].roomname).toBe('room-a')
    expect(FakeWebsocketProvider.instances[0].doc).toBe(store.ydoc)
    store.connectProvider()
    expect(FakeWebsocketProvider.instances).toHaveLength(1)
    store.disconnectProvider()
  })

  it('disconnectProvider 销毁 provider 并置空；ydoc/撤销栈继续可用（StrictMode 模拟重挂语义）', () => {
    const store = new DesignStore('ws://test:1234', sample(), 'room-a')
    store.connectProvider()
    const p = store.provider as unknown as FakeWebsocketProvider
    store.disconnectProvider()
    expect(p.destroyed).toBe(true)
    expect(store.provider).toBeNull()

    store.updateNode('a', (n) => ({ ...n, props: { text: '改' } }))
    expect(store.canUndo).toBe(true)
    expect(store.undo()).toBe(true)

    store.connectProvider()
    expect(FakeWebsocketProvider.instances).toHaveLength(2)
    expect(store.provider).toBe(FakeWebsocketProvider.instances[1])
    store.disconnectProvider()
  })

  it('connectProvider 重放已设置的 presence 昵称（重挂/重连后昵称不丢）', () => {
    const store = new DesignStore('ws://test:1234', sample(), 'room-a')
    store.setPresence('alice')
    store.connectProvider()
    expect(FakeWebsocketProvider.instances[0].awareness.setLocalStateField).toHaveBeenCalledWith(
      'user',
      { name: 'alice' },
    )
    store.disconnectProvider()
  })

  it('连接后 setPresence 立即写入当前 provider 的 awareness', () => {
    const store = new DesignStore('ws://test:1234', sample(), 'room-a')
    store.connectProvider()
    store.setPresence('bob')
    expect(FakeWebsocketProvider.instances[0].awareness.setLocalStateField).toHaveBeenCalledWith(
      'user',
      { name: 'bob' },
    )
    store.disconnectProvider()
  })

  it('reconnectRoom：旧 provider 销毁、新 provider 建立、presence 重放', () => {
    const store = new DesignStore('ws://test:1234', sample(), 'room-a')
    store.connectProvider()
    store.setPresence('alice')
    store.reconnectRoom('ws://test:1234', 'room-b')
    expect(FakeWebsocketProvider.instances[0].destroyed).toBe(true)
    expect(FakeWebsocketProvider.instances[1].roomname).toBe('room-b')
    expect(FakeWebsocketProvider.instances[1].awareness.setLocalStateField).toHaveBeenCalledWith(
      'user',
      { name: 'alice' },
    )
    store.disconnectProvider()
  })

  it('本地模式（无 wsUrl）：connectProvider 不建立连接，断开不抛', () => {
    const store = new DesignStore(undefined, sample())
    store.connectProvider()
    expect(store.provider).toBeNull()
    expect(() => store.disconnectProvider()).not.toThrow()
  })

  it('destroy() 完整销毁：provider 一并销毁', () => {
    const store = new DesignStore('ws://test:1234', sample(), 'room-a')
    store.connectProvider()
    const p = store.provider as unknown as FakeWebsocketProvider
    store.destroy()
    expect(p.destroyed).toBe(true)
  })
})
