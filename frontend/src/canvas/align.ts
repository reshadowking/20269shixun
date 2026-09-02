/**
 * 对齐/分布工具（v2.2 §3.3）。
 * free 模式：计算节点坐标/尺寸；flex 模式：返回父容器样式（justify/alignItems/gap）。
 * 纯函数，必须有单测覆盖（flex 与 free 两种模式）。
 */

export interface NodeRect {
  id: string
  x: number
  y: number
  w: number
  h: number
}

export type AlignOp =
  | 'left' | 'right' | 'hcenter'
  | 'top' | 'bottom' | 'vcenter'
  | 'hspace' | 'vspace'
  | 'uniform'

/** free 模式：返回每个节点的坐标/尺寸变更 */
export function alignFree(nodes: NodeRect[], op: AlignOp): Record<string, { x?: number; y?: number; w?: number; h?: number }> {
  if (nodes.length < 2) return {}
  const out: Record<string, { x?: number; y?: number; w?: number; h?: number }> = {}
  const minX = Math.min(...nodes.map((n) => n.x))
  const maxX = Math.max(...nodes.map((n) => n.x + n.w))
  const minY = Math.min(...nodes.map((n) => n.y))
  const maxY = Math.max(...nodes.map((n) => n.y + n.h))
  const centerX = (minX + maxX) / 2
  const centerY = (minY + maxY) / 2
  const maxW = Math.max(...nodes.map((n) => n.w))
  const maxH = Math.max(...nodes.map((n) => n.h))

  // 分布：按当前坐标排序，两端不动，中间均匀
  const sortedX = [...nodes].sort((a, b) => a.x - b.x)
  const sortedY = [...nodes].sort((a, b) => a.y - b.y)
  const spanX = maxX - minX
  const spanY = maxY - minY

  nodes.forEach((n) => {
    const delta: { x?: number; y?: number; w?: number; h?: number } = {}
    switch (op) {
      case 'left': delta.x = minX; break
      case 'right': delta.x = maxX - n.w; break
      case 'hcenter': delta.x = centerX - n.w / 2; break
      case 'top': delta.y = minY; break
      case 'bottom': delta.y = maxY - n.h; break
      case 'vcenter': delta.y = centerY - n.h / 2; break
      case 'hspace': {
        if (n.id === sortedX[0].id) delta.x = minX
        else if (n.id === sortedX[sortedX.length - 1].id) delta.x = maxX - n.w
        else {
          const i = sortedX.findIndex((s) => s.id === n.id)
          delta.x = minX + (spanX * i) / (sortedX.length - 1)
        }
        break
      }
      case 'vspace': {
        if (n.id === sortedY[0].id) delta.y = minY
        else if (n.id === sortedY[sortedY.length - 1].id) delta.y = maxY - n.h
        else {
          const i = sortedY.findIndex((s) => s.id === n.id)
          delta.y = minY + (spanY * i) / (sortedY.length - 1)
        }
        break
      }
      case 'uniform':
        delta.w = maxW
        delta.h = maxH
        break
    }
    if (Object.keys(delta).length) out[n.id] = delta
  })
  return out
}

/** flex 模式：返回父容器样式变更（v2.2 §3.3：对齐通过 justify-content/align-items，分布通过 gap） */
export function alignFlex(
  op: AlignOp,
): { justify?: 'flex-start' | 'center' | 'flex-end' | 'space-between'; alignItems?: 'flex-start' | 'center' | 'flex-end' | 'stretch' } | null {
  switch (op) {
    case 'left': return { justify: 'flex-start' }
    case 'right': return { justify: 'flex-end' }
    case 'hcenter': return { justify: 'center' }
    case 'top': return { alignItems: 'flex-start' }
    case 'bottom': return { alignItems: 'flex-end' }
    case 'vcenter': return { alignItems: 'center' }
    default: return null // hspace/vspace/uniform 在 flex 下不适用（gap 属于布局间距）
  }
}

/** 分布操作在 flex 模式下的 gap 等价（hspace 行布局 / vspace 列布局时设置统一 gap） */
export function alignFlexGap(op: AlignOp): number | null {
  return op === 'hspace' || op === 'vspace' ? 0 : null
}
