/**
 * React 绑定：useDesignStore（Yjs update 事件 → setState 重渲染）。
 * 采用 useState+useEffect 订阅（比 useSyncExternalStore 更直接可靠，
 * 避免 React 19 下 getSnapshot 缓存与 Yjs 桥的同步偏差）。
 * wsUrl 为空 → 纯本地模式（单测/离线兜底）；提供 → 连接 y-websocket 容器。
 */
import { useEffect, useRef, useState } from 'react'

import { DesignStore } from '@/yjs/designStore'
import type { DesignNode } from '@/design/types'

export function useDesignStore(wsUrl?: string, initialDesign?: DesignNode, room?: string): { design: DesignNode; store: DesignStore } {
  const storeRef = useRef<DesignStore | null>(null)
  if (!storeRef.current) {
    storeRef.current = new DesignStore(wsUrl, initialDesign, room)
  }
  const [design, setDesign] = useState<DesignNode>(() => storeRef.current!.getDesign())

  useEffect(() => {
    const store = storeRef.current!
    const unsub = store.subscribe(() => setDesign(store.getDesign()))
    return unsub
  }, [])

  return { design, store: storeRef.current }
}
