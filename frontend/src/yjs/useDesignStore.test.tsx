/**
 * T2 presence 连接泄漏回归（React 绑定层）：
 * 卸载（回主页/切会话）必须关闭 WebsocketProvider——修复前从不销毁，
 * 同一个人反复进出工作台在线人数 1→2→3→4；StrictMode 的
 * mount→cleanup→mount 语义下表现为断开→重连，store 必须保持可用。
 */
import { StrictMode } from 'react'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { FakeWebsocketProvider } from '../test/fakeYWebSocket'
import { useDesignStore } from './useDesignStore'
import type { DesignNode } from '@/design/types'

vi.mock('y-websocket', async () => ({
  WebsocketProvider: (await import('../test/fakeYWebSocket')).FakeWebsocketProvider,
}))

const DESIGN: DesignNode = {
  id: 'root',
  type: 'frame',
  children: [{ id: 'a', type: 'text', props: { text: '标题' } }],
}

describe('T2 useDesignStore：provider 随组件卸载销毁', () => {
  beforeEach(() => {
    FakeWebsocketProvider.reset()
  })

  it('挂载建立连接，卸载即销毁 provider（房间不再残留在线客户端）', () => {
    const { result, unmount } = renderHook(() => useDesignStore('ws://test:1234', DESIGN, 'room-a'))
    expect(result.current.design.id).toBe('root')
    expect(result.current.store.provider).not.toBeNull()
    unmount()
    expect(FakeWebsocketProvider.instances[0].destroyed).toBe(true)
    expect(result.current.store.provider).toBeNull()
  })

  it('StrictMode：模拟卸载重挂后 provider 重建，设计/订阅/撤销栈保留', () => {
    const { result, unmount } = renderHook(() => useDesignStore('ws://test:1234', DESIGN, 'room-a'), {
      wrapper: StrictMode,
    })
    // StrictMode mount→cleanup→mount：先连后断再重连 → 恰好两个实例，最后一个存活
    expect(FakeWebsocketProvider.instances).toHaveLength(2)
    expect(FakeWebsocketProvider.instances[0].destroyed).toBe(true)
    expect(result.current.store.provider).toBe(FakeWebsocketProvider.instances[1])

    expect(result.current.design.children?.[0].props?.text).toBe('标题')
    act(() => {
      result.current.store.updateNode('a', (n) => ({ ...n, props: { text: '改后' } }))
    })
    expect(result.current.design.children?.[0].props?.text).toBe('改后')
    expect(result.current.store.canUndo).toBe(true)
    unmount()
    expect(FakeWebsocketProvider.instances.every((p) => p.destroyed)).toBe(true)
  })

  it('本地模式（无 wsUrl）全程无连接', () => {
    const { result, unmount } = renderHook(() => useDesignStore(undefined, DESIGN))
    expect(result.current.store.provider).toBeNull()
    unmount()
    expect(FakeWebsocketProvider.instances).toHaveLength(0)
  })
})
