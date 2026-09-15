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
  }

  serverUrl: string
  roomname: string
  doc: unknown
  destroyed = false

  /** provider 自身的 on/off（DesignStore.bindProviderEvents 用它挂 status 事件） */
  on = vi.fn()
  off = vi.fn()

  awareness = {
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
