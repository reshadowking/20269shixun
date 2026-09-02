import { useCallback, useEffect, useRef, useState } from 'react'

import { DEFAULT_VIEW, ZOOM_LEVELS, nearestZoomLevel, viewportToCanvas, zoomAt, type ViewTransform } from '@/canvas/geometry'
import { NodeRenderer } from '@/canvas/NodeRenderer'
import { Button } from '@/components/ui/button'
import { findNode, findParent } from '@/design/tree'
import type { DesignNode } from '@/design/types'
import type { DesignStore } from '@/yjs/designStore'

/**
 * 设计画布（v2.2 §3.2/§3.4）。
 * 数据层：Yjs DesignStore（编辑走 transaction，协作天然支持）。
 * 交互：点击选中 / Ctrl+点击多选 / 拖拽（free 改 x-y、flex 重排）/ Delete 删除 / Ctrl+D 复制 /
 *       5 档缩放 + Ctrl+滚轮（以鼠标为中心）/ 空白拖拽平移。
 */

interface DragState {
  ids: string[]          // 被拖拽的选中组
  startClientX: number
  startClientY: number
  startPositions: Array<{ id: string; x: number; y: number }>
  parentId: string | null
  parentLayout: string | undefined
  moved: boolean
}

interface ResizeState {
  id: string
  dir: string
  startClientX: number
  startClientY: number
  startX: number
  startY: number
  startW: number
  startH: number
}

const MIN_SIZE = 8

interface DesignCanvasProps {
  design: DesignNode
  store: DesignStore
  selectedIds: Set<string>
  onSelectionChange: (ids: Set<string>) => void
  /** 组件库拖入画布：type + 画布世界坐标（自由布局落点） */
  onDropComponent?: (type: string, x: number, y: number) => void
  /** 画布外背景网格点（P2-11，Figma 风格坐标纸） */
  showGrid?: boolean
  /** 右键菜单（E3-2/E3-3）：nodeId 为当前选中节点（可为 null），x/y 为画布内坐标 */
  onContextMenu?: (nodeId: string | null, x: number, y: number) => void
  /** P0-1 增量编辑：被修改节点高亮 */
  highlightIds?: Set<string>
}

export default function DesignCanvas({ design, store, selectedIds, onSelectionChange, onDropComponent, showGrid = true, onContextMenu, highlightIds }: DesignCanvasProps) {
  const [view, setView] = useState<ViewTransform>(DEFAULT_VIEW)
  const dragRef = useRef<DragState | null>(null)
  const resizeRef = useRef<ResizeState | null>(null)
  const panRef = useRef<{ x: number; y: number } | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // ---- 视图：缩放与平移 ----
  const setZoomLevel = useCallback((level: number) => {
    const el = containerRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    setView((v) => zoomAt(rect.width / 2, rect.height / 2, v, level))
  }, [])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      const cur = nearestZoomLevel(view.scale)
      const idx = ZOOM_LEVELS.indexOf(cur as (typeof ZOOM_LEVELS)[number])
      const dir = e.deltaY < 0 ? 1 : -1
      const next = ZOOM_LEVELS[Math.max(0, Math.min(ZOOM_LEVELS.length - 1, idx + dir))]
      setView((v) => zoomAt(e.clientX - rect.left, e.clientY - rect.top, v, next))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [view.scale])

  // ---- 键盘：删除 / 复制 ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return
      // P0-1 操作级撤销/重做：Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y（无需选中，删除后可撤销）
      if ((e.key === 'z' && (e.ctrlKey || e.metaKey)) || (e.key === 'y' && (e.ctrlKey || e.metaKey))) {
        e.preventDefault()
        if (e.key === 'y' || e.shiftKey) store.redo()
        else store.undo()
        onSelectionChange(new Set())
        return
      }
      if (selectedIds.size === 0) return
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        selectedIds.forEach((id) => store.removeNode(id))
        onSelectionChange(new Set())
      } else if (e.key === 'd' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault()
        selectedIds.forEach((id) => store.duplicateNode(id))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedIds, store, onSelectionChange])

  // ---- 选中（统一在 pointerdown 处理，避免 click 二次切换）----

  // ---- 节点拖拽 ----
  const handleNodePointerDown = useCallback(
    (e: React.PointerEvent, id: string) => {
      e.stopPropagation()
      const additive = e.ctrlKey || e.metaKey
      let group: string[]
      if (additive) {
        const next = new Set(selectedIds)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        onSelectionChange(next)
        group = next.has(id) ? [...next] : [id]
      } else {
        if (!selectedIds.has(id)) {
          onSelectionChange(new Set([id]))
          group = [id]
        } else {
          group = [...selectedIds]
        }
      }
      const parent = findParent(design, id)
      dragRef.current = {
        ids: group,
        startClientX: e.clientX,
        startClientY: e.clientY,
        startPositions: group.map((gid) => {
          const node = findNode(design, gid)
          return { id: gid, x: node?.x ?? 0, y: node?.y ?? 0 }
        }),
        parentId: parent?.id ?? null,
        parentLayout: parent?.style?.layout,
        moved: false,
      }
      // 指针捕获挂到画布容器：保证后续 move/up 稳定到达容器 handler
      containerRef.current?.setPointerCapture?.(e.pointerId)
    },
    [design, selectedIds, onSelectionChange],
  )

  // ---- 缩放（resize 手柄）----
  const handleResizeStart = useCallback(
    (e: React.PointerEvent, id: string, dir: string) => {
      e.stopPropagation()
      const node = findNode(design, id)
      if (!node) return
      const w = typeof node.style?.width === 'number' ? node.style.width : 100
      const h = typeof node.style?.height === 'number' ? node.style.height : 40
      resizeRef.current = {
        id,
        dir,
        startClientX: e.clientX,
        startClientY: e.clientY,
        startX: node.x ?? 0,
        startY: node.y ?? 0,
        startW: w,
        startH: h,
      }
      containerRef.current?.setPointerCapture?.(e.pointerId)
    },
    [design],
  )

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      const el = containerRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()

      // 缩放（resize 手柄）
      const resize = resizeRef.current
      if (resize) {
        const delta = viewportToCanvas(e.clientX - rect.left, e.clientY - rect.top, view)
        const start = viewportToCanvas(resize.startClientX - rect.left, resize.startClientY - rect.top, view)
        const dx = delta.x - start.x
        const dy = delta.y - start.y
        let { startX, startY, startW, startH } = resize
        let x = startX
        let y = startY
        let w = startW
        let h = startH
        if (resize.dir.includes('e')) w = startW + dx
        if (resize.dir.includes('s')) h = startH + dy
        if (resize.dir.includes('w')) { w = startW - dx; x = startX + dx }
        if (resize.dir.includes('n')) { h = startH - dy; y = startY + dy }
        if (w < MIN_SIZE) { w = MIN_SIZE; if (resize.dir.includes('w')) x = startX + (startW - MIN_SIZE) }
        if (h < MIN_SIZE) { h = MIN_SIZE; if (resize.dir.includes('n')) y = startY + (startH - MIN_SIZE) }
        store.updateNode(resize.id, (n) => ({
          ...n,
          x: Math.round(x),
          y: Math.round(y),
          style: { ...(n.style ?? {}), width: Math.round(w), height: Math.round(h) },
        }))
        return
      }

      // 空白平移：先算 delta（闭包内快照），再 setView —— 避免 updater 延迟执行时读到已更新的 ref（白屏根因）
      if (panRef.current) {
        const dx = e.clientX - panRef.current.x
        const dy = e.clientY - panRef.current.y
        panRef.current = { x: e.clientX, y: e.clientY }
        setView((v) => ({ ...v, tx: v.tx + dx, ty: v.ty + dy }))
        return
      }
      const drag = dragRef.current
      if (!drag) return
      const delta = viewportToCanvas(e.clientX - rect.left, e.clientY - rect.top, view)
      const start = viewportToCanvas(drag.startClientX - rect.left, drag.startClientY - rect.top, view)
      const dx = delta.x - start.x
      const dy = delta.y - start.y
      if (!drag.moved && Math.abs(dx) < 2 && Math.abs(dy) < 2) return
      drag.moved = true

      if (drag.parentLayout === 'free') {
        // 绝对定位：整组更新 x/y
        drag.startPositions.forEach((sp) => {
          store.updateNode(sp.id, (n) => ({ ...n, x: sp.x + dx, y: sp.y + dy }))
        })
      } else if (drag.parentId && drag.ids.length === 1) {
        // flex 布局：单节点按鼠标位置实时重排
        const parentEl = el.querySelector(`[data-node-id="${drag.parentId}"]`)
        if (parentEl) {
          const siblings = Array.from(parentEl.children).filter(
            (c) => c instanceof HTMLElement && c.dataset.nodeId,
          ) as HTMLElement[]
          const pointerX = e.clientX - rect.left - view.tx
          const pointerY = e.clientY - rect.top - view.ty
          let targetIndex = siblings.length - 1
          for (let i = 0; i < siblings.length; i++) {
            const b = siblings[i].getBoundingClientRect()
            const cx = b.left - rect.left - view.tx
            const cy = b.top - rect.top - view.ty
            const inside =
              pointerX >= cx && pointerX <= cx + b.width &&
              pointerY >= cy && pointerY <= cy + b.height
            if (inside) {
              // 与 pointerX 同单位（视口像素）：前半插入 i，后半插入 i+1
              const half = cx + b.width / 2
              targetIndex = pointerX < half ? i : i + 1
              break
            }
          }
          store.moveChild(drag.ids[0], drag.parentId, targetIndex)
        }
      }
    },
    [view, store],
  )

  const handlePointerUp = useCallback(() => {
    dragRef.current = null
    resizeRef.current = null
    panRef.current = null
  }, [])

  // ---- 空白：平移 + 取消选中（节点 / 工具条之外均可平移，含画布白纸内空白）----
  const handleBackgroundPointerDown = useCallback(
    (e: React.PointerEvent) => {
      const target = e.target as HTMLElement
      if (target.closest('[data-node-id]')) return       // 节点上的拖拽由 handleNodePointerDown 处理
      if (target.closest('[data-testid="zoom-toolbar"]')) return
      onSelectionChange(new Set())
      panRef.current = { x: e.clientX, y: e.clientY }
      containerRef.current?.setPointerCapture?.(e.pointerId)
    },
    [onSelectionChange],
  )

  // ---- 画布尺寸（根节点 style，默认 800×600）----
  const sheetW = typeof design.style?.width === 'number' ? design.style.width : 800
  const sheetH = typeof design.style?.height === 'number' ? design.style.height : 600

  // 画布水平垂直居中（P5）：初始与尺寸/容器变化时重居中；用户平移/缩放后不干预
  const centerView = useCallback(() => {
    const el = containerRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    setView((v) => {
      const s = v.scale
      return { scale: s, tx: Math.max(0, (rect.width - sheetW * s) / 2), ty: Math.max(0, (rect.height - sheetH * s) / 2) }
    })
  }, [sheetW, sheetH])

  useEffect(() => {
    centerView()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheetW, sheetH])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(() => centerView())
    ro.observe(el)
    return () => ro.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [centerView])

  // ---- 组件库拖入（HTML5 DnD）----
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
  }, [])

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      const type = e.dataTransfer.getData('application/design-component')
      if (!type || !onDropComponent) return
      const el = containerRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      const point = viewportToCanvas(e.clientX - rect.left, e.clientY - rect.top, view)
      onDropComponent(type, point.x, point.y)
    },
    [view, onDropComponent],
  )

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full overflow-hidden select-none"
      data-testid="design-canvas"
      data-root-layout={design.style?.layout}
      data-yjs-layout={store.getDesign().style?.layout}
      style={{
        WebkitUserSelect: 'none',
        userSelect: 'none',
        background: showGrid
          ? 'radial-gradient(circle, #c9cfd8 1px, transparent 1px) #EEF0F4'
          : '#EEF0F4',
        backgroundSize: showGrid ? '20px 20px' : undefined,
      }}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerDown={handleBackgroundPointerDown}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      onContextMenu={(e) => {
        e.preventDefault()
        if (!onContextMenu) return
        const el = containerRef.current
        if (!el) return
        const rect = el.getBoundingClientRect()
        const nodeId = selectedIds.size === 1 ? [...selectedIds][0] : null
        onContextMenu(nodeId, e.clientX - rect.left, e.clientY - rect.top)
      }}
    >
      {/* 画布世界（平移 + 缩放） */}
      <div
        className="absolute"
        style={{
          transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.scale})`,
          transformOrigin: '0 0',
        }}
        data-testid="canvas-world"
      >
        <div
          className="bg-white shadow-md"
          style={{ width: sheetW, height: sheetH, borderRadius: 8 }}
          data-testid="canvas-sheet"
        >
          <NodeRenderer
            node={design}
            selectedIds={selectedIds}
            highlightIds={highlightIds}
            onDragStart={handleNodePointerDown}
            onResizeStart={handleResizeStart}
            onComponentPropsChange={(id, key, value) =>
              store.updateNode(id, (n) => ({ ...n, props: { ...(n.props ?? {}), [key]: value } }))
            }
          />
        </div>
      </div>

      {/* 缩放工具条 */}
      <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-lg border bg-background p-1 shadow-md" data-testid="zoom-toolbar">
        {ZOOM_LEVELS.map((level) => (
          <Button
            key={level}
            size="sm"
            variant={Math.abs(view.scale - level) < 0.01 ? 'default' : 'ghost'}
            className="h-7 px-2 text-xs"
            data-testid={`zoom-${level}`}
            onClick={() => setZoomLevel(level)}
          >
            {Math.round(level * 100)}%
          </Button>
        ))}
        <span className="px-2 text-xs text-muted-foreground">Ctrl+点击多选 · Ctrl+滚轮缩放 · 拖空白平移</span>
      </div>
    </div>
  )
}
