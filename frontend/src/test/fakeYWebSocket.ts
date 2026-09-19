/**
 * 测试替身：y-websocket 的 WebsocketProvider（配合 vi.mock('y-websocket') 使用）。
 * 无网络、无定时器，记录构造参数与 destroy/awareness 写入，供生命周期断言：
 *   vi.mock('y-websocket', async () => ({
 *     WebsocketProvider: (await import('../test/fakeYWebSocket')).FakeWebsocketProvider,
 *   }))
 */
import { vi } from 'vitest'

export class FakeWebsocketProvider {
  /** 全部实例按创建顺序登记，测试用 beforeEach(reset) 清空 */
  static instances: FakeWebsocketProvider[] = []

  static reset(): void {
    FakeWebsocketProvider.instances = []
    FakeWebsocketProvider.autoSync = true
  }

  /**
   * 替身是否"一连上就已经同步好、且房间是空的"（2026-09-17 B+）。
   *
   * 默认 true —— 既有的一批用例是"构造 store + connectProvider() + 立刻断言树"，
   * 在默认值下语义等价于"新房间、同步完成"，所以它们照旧拿到自己那份种子。
   * 要验"房间已有内容 / 还没同步"的路径，先置 false，再手动 `emit('sync', true)`。
   */
  static autoSync = true

  serverUrl: string
  roomname: string
  doc: unknown
  destroyed = false
  /** 与真实 y-websocket 同名：首次 sync 完成后为 true */
  synced = FakeWebsocketProvider.autoSync
  /** presence/awareness 的本地 clientId（真实 provider 也有这个字段） */
  clientID = 1

  /**
   * provider 自身的 on/off（DesignStore 用它挂 `status` 与 `sync`）。做**真**的事件登记，
   * 这样测试可以 `emit('sync', true)` 驱动"先连上、后同步"的时序。
   */
  private handlers = new Map<string, Set<(...args: unknown[]) => void>>()

  on(event: string, cb: (...args: unknown[]) => void): void {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set())
    this.handlers.get(event)!.add(cb)
  }

  off(event: string, cb: (...args: unknown[]) => void): void {
    this.handlers.get(event)?.delete(cb)
  }

  /** 测试用：触发某个事件（例如 `emit('sync', true)` / `emit('status', { status: 'disconnected' })`） */
  emit(event: string, arg?: unknown): void {
    this.handlers.get(event)?.forEach((cb) => cb(arg))
  }

  awareness = {
    /** 本地 clientId：DesignStore 用它排除"自己的光标"（真实 awareness 也有） */
    clientID: 1,
    on: vi.fn(),
    off: vi.fn(),
    setLocalStateField: vi.fn(),
    getStates: vi.fn(() => new Map<never, never>()),
  }

  constructor(serverUrl: string, roomname: string, doc: unknown) {
    this.serverUrl = serverUrl
    this.roomname = roomname
    this.doc = doc
    FakeWebsocketProvider.instances.push(this)
  }

  destroy(): void {
    this.destroyed = true
  }
}
