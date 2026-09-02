import { describe, expect, it } from 'vitest'

import { canvasToViewport, nearestZoomLevel, rectsIntersect, viewportToCanvas, zoomAt, ZOOM_LEVELS } from './geometry'

describe('viewportToCanvas / canvasToViewport', () => {
  it('identity transform 双向一致', () => {
    expect(viewportToCanvas(100, 50, { scale: 1, tx: 0, ty: 0 })).toEqual({ x: 100, y: 50 })
    expect(canvasToViewport(100, 50, { scale: 1, tx: 0, ty: 0 })).toEqual({ x: 100, y: 50 })
  })

  it('带平移的换算（POC：命中测试核心）', () => {
    const view = { scale: 1, tx: 30, ty: 20 }
    expect(viewportToCanvas(130, 70, view)).toEqual({ x: 100, y: 50 })
    expect(canvasToViewport(100, 50, view)).toEqual({ x: 130, y: 70 })
  })

  it('带缩放的换算（POC：缩放后点击命中）', () => {
    const view = { scale: 2, tx: 0, ty: 0 }
    // 200% 缩放下，视口 (100, 50) 对应画布 (50, 25)
    expect(viewportToCanvas(100, 50, view)).toEqual({ x: 50, y: 25 })
    expect(canvasToViewport(50, 25, view)).toEqual({ x: 100, y: 50 })
  })

  it('平移 + 缩放组合', () => {
    const view = { scale: 0.5, tx: 100, ty: -40 }
    expect(viewportToCanvas(200, 10, view)).toEqual({ x: 200, y: 100 })
    expect(canvasToViewport(200, 100, view)).toEqual({ x: 200, y: 10 })
  })
})

describe('zoomAt（以鼠标为中心缩放）', () => {
  it('缩放前后锚点画布坐标不变', () => {
    const view = { scale: 1, tx: 0, ty: 0 }
    const anchor = viewportToCanvas(300, 200, view)
    const next = zoomAt(300, 200, view, 2)
    expect(next.scale).toBe(2)
    const anchorAfter = viewportToCanvas(300, 200, next)
    expect(anchorAfter.x).toBeCloseTo(anchor.x)
    expect(anchorAfter.y).toBeCloseTo(anchor.y)
  })

  it('已平移状态下缩放锚点仍然保持', () => {
    const view = { scale: 1.5, tx: 80, ty: -30 }
    const px = 400
    const py = 250
    const anchor = viewportToCanvas(px, py, view)
    const next = zoomAt(px, py, view, 0.75)
    const anchorAfter = viewportToCanvas(px, py, next)
    expect(anchorAfter.x).toBeCloseTo(anchor.x, 5)
    expect(anchorAfter.y).toBeCloseTo(anchor.y, 5)
  })

  it('缩放被钳制在 0.25~4', () => {
    expect(zoomAt(0, 0, { scale: 1, tx: 0, ty: 0 }, 10).scale).toBe(4)
    expect(zoomAt(0, 0, { scale: 1, tx: 0, ty: 0 }, 0.01).scale).toBe(0.25)
  })
})

describe('nearestZoomLevel', () => {
  it('取最近档位', () => {
    expect(nearestZoomLevel(0.9)).toBe(1)
    expect(nearestZoomLevel(0.6)).toBe(0.5) // 0.6 距 0.5 更近
    expect(nearestZoomLevel(1.8)).toBe(2)
    expect(ZOOM_LEVELS).toEqual([0.5, 0.75, 1, 1.5, 2])
  })
})

describe('rectsIntersect', () => {
  it('相交 / 不相交 / 边界', () => {
    const a = { x: 0, y: 0, width: 100, height: 100 }
    expect(rectsIntersect(a, { x: 50, y: 50, width: 100, height: 100 })).toBe(true)
    expect(rectsIntersect(a, { x: 200, y: 200, width: 10, height: 10 })).toBe(false)
    expect(rectsIntersect(a, { x: 100, y: 0, width: 10, height: 10 })).toBe(false)
  })
})
