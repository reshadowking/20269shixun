/**
 * 画布视图几何（v2.2 §3.4）。
 * 视图模型：世界坐标 = (视口坐标 - 平移) / 缩放。
 * 这些是纯函数，必须有单元测试覆盖（缩放后命中测试是本项目硬截止 POC）。
 */

export interface ViewTransform {
  scale: number
  tx: number
  ty: number
}

export const ZOOM_LEVELS = [0.5, 0.75, 1, 1.5, 2] as const

export const DEFAULT_VIEW: ViewTransform = { scale: 1, tx: 0, ty: 0 }

/** 视口坐标 → 画布世界坐标（命中测试、拖拽换算的核心） */
export function viewportToCanvas(
  px: number,
  py: number,
  view: ViewTransform,
): { x: number; y: number } {
  return { x: (px - view.tx) / view.scale, y: (py - view.ty) / view.scale }
}

/** 画布世界坐标 → 视口坐标 */
export function canvasToViewport(
  x: number,
  y: number,
  view: ViewTransform,
): { x: number; y: number } {
  return { x: x * view.scale + view.tx, y: y * view.scale + view.ty }
}

/**
 * 以视口内某点（如鼠标）为中心缩放：缩放前后该点对应的画布坐标保持不变。
 * 这是 Ctrl+滚轮/按钮缩放的数学核心。
 */
export function zoomAt(
  px: number,
  py: number,
  view: ViewTransform,
  newScale: number,
): ViewTransform {
  const clamped = Math.min(4, Math.max(0.25, newScale))
  const anchor = viewportToCanvas(px, py, view)
  return {
    scale: clamped,
    tx: px - anchor.x * clamped,
    ty: py - anchor.y * clamped,
  }
}

/** 缩放级别取整（POC：按钮切换 5 档） */
export function nearestZoomLevel(scale: number): number {
  let best: number = ZOOM_LEVELS[0]
  for (const level of ZOOM_LEVELS) {
    if (Math.abs(level - scale) < Math.abs(best - scale)) best = level
  }
  return best
}

/** 矩形相交（用于自由布局的命中测试/对齐计算） */
export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export function rectsIntersect(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  )
}
