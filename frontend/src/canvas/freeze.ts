/**
 * 转自由画布（P1-13）：像素级冻结。
 *
 * 目标语义：**保留当前视觉现状，只把子节点变成可拖拽**，而不是重新排布。
 *
 * 坐标系规则（易错点，改动前先读）：
 * - 节点 x/y 的原点 = 父级 **padding box** 左上角（= 父级 border box 内缩 border 宽度）；
 *   abspos 子元素不受父级 padding 影响，因此只减 border，不减 padding；
 * - style.width/height 是 **border box** 尺寸（NodeRenderer 设了 boxSizing: 'border-box'），
 *   与 getBoundingClientRect() 口径一致；
 * - 屏幕像素 → 画布单位必须 **除以 view.scale**（画布纸张带 translate+scale 变换）。
 */
import type { DesignNode } from '@/design/types'

export interface FreezeMeasurement {
  id: string
  /** 画布单位，相对父级 padding box */
  x: number
  y: number
  /** border box 尺寸（画布单位） */
  width: number
  height: number
}

export interface FreezeMeasureResult {
  measurements: FreezeMeasurement[]
  /** 测不到的节点（如 hidden 未渲染），调用方需提示而非静默 */
  missing: string[]
}

/**
 * 读取容器内直接子节点的冻结坐标（画布单位）。
 *
 * @param container 画布容器（含 data-testid="canvas-sheet" 的祖先即可）
 * @param parentId  父节点 id（其元素带 data-node-id）
 * @param childIds  待冻结的直接子节点 id
 * @param scale     当前画布缩放（DesignCanvas 的 view.scale）
 */
export function measureChildren(
  container: HTMLElement,
  parentId: string,
  childIds: string[],
  scale: number,
): FreezeMeasureResult {
  const safeScale = scale > 0 ? scale : 1
  const parentEl = container.querySelector<HTMLElement>(`[data-node-id="${parentId}"]`)
  if (!parentEl) return { measurements: [], missing: [...childIds] }

  const parentRect = parentEl.getBoundingClientRect()
  const computed = getComputedStyle(parentEl)
  // 包含块原点 = border box 内缩 border 宽度（padding 不影响 abspos 子元素）
  const originX = Number.parseFloat(computed.borderLeftWidth) || 0
  const originY = Number.parseFloat(computed.borderTopWidth) || 0

  const measurements: FreezeMeasurement[] = []
  const missing: string[] = []

  for (const id of childIds) {
    const el = container.querySelector<HTMLElement>(`[data-node-id="${id}"]`)
    if (!el) {
      missing.push(id)
      continue
    }
    const rect = el.getBoundingClientRect()
    if (rect.width === 0 && rect.height === 0) {
      missing.push(id)
      continue
    }
    measurements.push({
      id,
      x: (rect.left - parentRect.left) / safeScale - originX,
      y: (rect.top - parentRect.top) / safeScale - originY,
      // 宽度向上取整：文本节点靠宽度断行，向下取整可能触发额外换行
      width: Math.ceil(rect.width / safeScale),
      height: Math.round(rect.height / safeScale),
    })
  }

  return { measurements, missing }
}

/**
 * 把测量结果冻结进子节点（纯函数，便于单测）。
 *
 * - 测到的节点：写入 x/y 与 style.width/height（覆盖百分比/自适应尺寸——这正是"冻结"的含义）
 * - 测不到的节点：原样返回，由调用方决定提示方式
 */
export function freezeToFreeLayout(
  children: DesignNode[],
  measurements: FreezeMeasurement[],
): DesignNode[] {
  const byId = new Map(measurements.map((m) => [m.id, m]))
  return children.map((child) => {
    const m = byId.get(child.id)
    if (!m) return child
    return {
      ...child,
      x: Math.round(m.x),
      y: Math.round(m.y),
      // 宽度向上取整（防文本重新换行）；高度四舍五入。此处再归一一次，
      // 保证无论测量来源如何，落库数值都是整数。
      style: { ...(child.style ?? {}), width: Math.ceil(m.width), height: Math.round(m.height) },
    }
  })
}
