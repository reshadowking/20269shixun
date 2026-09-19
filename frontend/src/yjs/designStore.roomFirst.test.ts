/**
 * B+「协作 seed 覆盖旧稿」（2026-09-17）。
 *
 * 原实现：构造函数**在连接之前**就把"从 DB 读出来的旧稿"写进本地 Y.Doc。房间若已有别人
 * 未保存的编辑，两份并发 item 由 clientID 决定胜负 —— 约一半概率把房间里的新编辑覆盖回旧稿
 * （实测两侧一起回退）。用户故事：A 在画布上改了一堆没保存 → B 打开同一稿件 → A 的改动没了。
 *
 * 修法（**房间为准**）：有协作端点时不先写，等 provider 首个 `sync` 再决定 ——
 *   房间空 → 写本地副本；房间已有内容 → 采用房间状态；一直连不上 → 兜底超时后按本地副本渲染。
 */
import * as Y from 'yjs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { DesignNode } from '@/design/types'

import { FakeWebsocketProvider } from '../test/fakeYWebSocket'

import { DesignStore, SEED_FALLBACK_MS } from './designStore'

vi.mock('y-websocket', async () => ({
  WebsocketProvider: (await import('../test/fakeYWebSocket')).FakeWebsocketProvider,
}))

function design(text: string): DesignNode {
  return {
    id: 'root',
    type: 'frame',
    style: { layout: 'column' },
    children: [{ id: 't1', type: 'text', props: { text } }],
  }
}

/** 读画布里那行文字（没有则返回 null） */
function textOf(store: DesignStore): string | null {
  const node = store.getDesign().children?.find((c) => c.id === 't1')
  return (node?.props?.text as string | undefined) ?? null
}

/** 模拟"房间里已经有别人写进去的内容"：把另一份文档的状态灌进目标文档，再宣布同步完成 */
function seedRoom(store: DesignStore, roomText: string): void {
  const other = new DesignStore(undefined, design(roomText)) // 无端点 = 本地模式，立刻写
  Y.applyUpdate(store.ydoc, Y.encodeStateAsUpdate(other.ydoc))
  other.destroy()
}

describe('DesignStore：协作房间为准（不覆盖房间里别人未保存的编辑）', () => {
  beforeEach(() => {
    localStorage.clear()
    FakeWebsocketProvider.reset()
  })
  afterEach(() => {
    vi.useRealTimers()
    FakeWebsocketProvider.reset()
    localStorage.clear()
  })

  it('有协作端点时，同步之前**不往文档里写任何东西**（正是这一步在覆盖房间的新编辑）', () => {
    FakeWebsocketProvider.autoSync = false
    const store = new DesignStore('ws://fake:1234', design('DB 旧稿'), 'room-a')
    store.connectProvider()

    expect(store.getDesign().id, '连接前不许 seed').toBe('empty')
    expect(store.dataReady, '还没同步 → 数据不算就绪').toBe(false)
    store.destroy()
  })

  it('同步后发现房间已有内容 → 采用房间状态（本地读到的那份旧稿被丢弃）', () => {
    FakeWebsocketProvider.autoSync = false
    const store = new DesignStore('ws://fake:1234', design('DB 旧稿'), 'room-a')
    store.connectProvider()
    seedRoom(store, '队友刚写的（未保存）')

    FakeWebsocketProvider.instances[0].emit('sync', true)

    expect(textOf(store)).toBe('队友刚写的（未保存）')
    expect(store.dataReady).toBe(true)
    store.destroy()
  })

  it('同步后发现房间是空的 → 写入本地副本（新房间照常"打开即正确"）', () => {
    FakeWebsocketProvider.autoSync = false
    const store = new DesignStore('ws://fake:1234', design('我的稿件'), 'room-new')
    store.connectProvider()

    FakeWebsocketProvider.instances[0].emit('sync', true)

    expect(textOf(store)).toBe('我的稿件')
    expect(store.dataReady).toBe(true)
    store.destroy()
  })

  it('一直连不上 → 兜底时间到就按本地副本渲染，并标记 degraded（否则画布会一直空着）', () => {
    vi.useFakeTimers()
    FakeWebsocketProvider.autoSync = false
    const store = new DesignStore('ws://fake:1234', design('我的稿件'), 'room-slow')
    store.connectProvider()
    expect(textOf(store)).toBeNull()

    vi.advanceTimersByTime(SEED_FALLBACK_MS + 10)

    expect(textOf(store), '兜底后必须能渲染').toBe('我的稿件')
    expect(store.degraded).toBe(true)
    expect(store.dataReady).toBe(true)
    store.destroy()
  })

  it('打开稿件（applyLoadedDesign）不许覆盖房间里别人的内容', () => {
    FakeWebsocketProvider.autoSync = false
    const store = new DesignStore('ws://fake:1234', design('占位'), 'room-a')
    store.connectProvider()
    seedRoom(store, '队友刚写的')
    FakeWebsocketProvider.instances[0].emit('sync', true)

    // 页面随后才拿到 DB 里那份稿件 → 这时房间里的才是事实来源
    store.applyLoadedDesign(design('DB 里保存的'))

    expect(textOf(store)).toBe('队友刚写的')
    store.destroy()
  })

  it('房间里的东西是**我自己的占位副本**时，打开稿件可以覆盖它（不然页面永远显示占位稿）', () => {
    FakeWebsocketProvider.autoSync = false
    const store = new DesignStore('ws://fake:1234', design('占位'), 'room-a')
    store.connectProvider()
    FakeWebsocketProvider.instances[0].emit('sync', true) // 房间空 → 写入占位副本
    expect(textOf(store)).toBe('占位')

    store.applyLoadedDesign(design('DB 里保存的'))

    expect(textOf(store)).toBe('DB 里保存的')
    store.destroy()
  })

  it('无协作端点（本地模式/单测）→ 立刻写入且立刻就绪，行为与以前一致', () => {
    const store = new DesignStore(undefined, design('本地稿'), 'room-local')
    expect(textOf(store)).toBe('本地稿')
    expect(store.dataReady).toBe(true)
    expect(FakeWebsocketProvider.instances).toHaveLength(0)
    store.destroy()
  })
})
