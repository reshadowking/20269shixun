/**
 * React 绑定：useDesignStore（Yjs update 事件 → setState 重渲染）。
 * 采用 useState+useEffect 订阅（比 useSyncExternalStore 更直接可靠，
 * 避免 React 19 下 getSnapshot 缓存与 Yjs 桥的同步偏差）。
 * wsUrl 为空 → 纯本地模式（单测/离线兜底）；提供 → 连接 y-websocket 容器。
 *
 * T2 presence 泄漏修复：store（ydoc，无外部句柄）仍在渲染期创建、每挂载一份；
 * 对外连接（WebsocketProvider）改在 effect 内建立、cleanup 内断开——组件卸载
 * （回主页/切会话）即关闭协作连接，服务端 presence 不再虚增。StrictMode 的
 * mount→cleanup→mount 语义下表现为断开→重连，store 本体保持可用（勿整库销毁）。
 */
import { useEffect, useRef, useState } from 'react'

import { DesignStore } from '@/yjs/designStore'
import type { DesignNode } from '@/design/types'

export function useDesignStore(wsUrl?: string, initialDesign?: DesignNode, room?: string): { design: DesignNode; store: DesignStore } {
  const storeRef = useRef<DesignStore | null>(null)
  if (!storeRef.current) {
    // 2026-09-17（B+）：initialDesign 只作为**占位副本**交给 store（有协作端点时它不会在连接前
    // 写进文档，而是等首个 sync 确认房间为空才写）。真正的稿件由页面 applyLoadedDesign 提供，
    // 且可以覆盖这份占位副本 —— 详见 DesignStore 构造函数与 wroteOwnSeed。
    storeRef.current = new DesignStore(wsUrl, initialDesign, room)
  }
  const [design, setDesign] = useState<DesignNode>(() => storeRef.current!.getDesign())

  useEffect(() => {
    const store = storeRef.current!
    const unsub = store.subscribe(() => setDesign(store.getDesign()))
    store.connectProvider(wsUrl, room)
    return () => {
      unsub()
      store.disconnectProvider()
    }
  }, [wsUrl, room])

  return { design, store: storeRef.current }
}
