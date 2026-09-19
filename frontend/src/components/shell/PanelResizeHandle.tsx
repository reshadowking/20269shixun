/**
 * 右侧面板的拖拽分隔条（T49）。
 *
 * 拖拽模式照搬 `canvas/DesignCanvas` 的 pointer 实现：pointerdown 记起点 +
 * `setPointerCapture`，pointermove 算差值，pointerup 收尾。
 *
 * 两条约定：
 * - 面板在**右侧**，所以向左拖 = 变宽（`startWidth - dx`）；
 * - `pointermove` 只回调宽度，**落盘在 pointerup**（拖拽期间写 storage 会因高频写而抖）。
 */
import { useCallback, useRef } from 'react'

import {
  PANEL_WIDTH_DEFAULT,
  PANEL_WIDTH_MIN,
  PANEL_WIDTH_STEP,
  clampPanelWidth,
  writePanelWidth,
} from '@/lib/panelWidth'

interface PanelResizeHandleProps {
  /** 当前面板宽度（px） */
  width: number
  /** 宽度变化回调（拖拽中会高频调用；调用方只更新 state，不要落盘） */
  onWidthChange: (width: number) => void
}

export default function PanelResizeHandle({ width, onWidthChange }: PanelResizeHandleProps) {
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null)
  const latestRef = useRef(width)

  const emit = useCallback(
    (next: number) => {
      latestRef.current = next
      onWidthChange(next)
    },
    [onWidthChange],
  )

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      dragRef.current = { startX: e.clientX, startWidth: width }
      latestRef.current = width
      e.currentTarget.setPointerCapture?.(e.pointerId)
      e.preventDefault()
    },
    [width],
  )

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current
      if (!drag) return
      // 面板在右侧：向左拖（dx < 0）→ 变宽
      emit(clampPanelWidth(drag.startWidth - (e.clientX - drag.startX), window.innerWidth))
    },
    [emit],
  )

  const handlePointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return
    dragRef.current = null
    e.currentTarget.releasePointerCapture?.(e.pointerId)
    writePanelWidth(latestRef.current)
  }, [])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
      e.preventDefault()
      const delta = e.key === 'ArrowLeft' ? PANEL_WIDTH_STEP : -PANEL_WIDTH_STEP
      const next = clampPanelWidth(latestRef.current + delta, window.innerWidth)
      emit(next)
      writePanelWidth(next)
    },
    [emit],
  )

  const handleDoubleClick = useCallback(() => {
    const next = clampPanelWidth(PANEL_WIDTH_DEFAULT, window.innerWidth)
    emit(next)
    writePanelWidth(next)
  }, [emit])

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="调整面板宽度"
      aria-valuenow={width}
      aria-valuemin={PANEL_WIDTH_MIN}
      tabIndex={0}
      data-testid="panel-resize-handle"
      className="w-1 shrink-0 cursor-col-resize bg-transparent transition-colors hover:bg-primary/30 focus-visible:bg-primary/40 focus-visible:outline-none"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onKeyDown={handleKeyDown}
      onDoubleClick={handleDoubleClick}
    />
  )
}
