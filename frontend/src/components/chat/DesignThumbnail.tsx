/**
 * 方案缩略图（缺陷 1）：复用画布渲染层（NodeRenderer）按比例缩放的真实投影，
 * 不是另画一套示意图；decorative 模式保证不输出 data-testid / 指针事件，
 * 不干扰画布自身的 node-* 选择器。
 */
import { NodeRenderer } from '@/canvas/NodeRenderer'
import type { DesignNode } from '@/design/types'

const EMPTY_SELECTION: Set<string> = new Set()

export default function DesignThumbnail({
  design,
  width = 168,
  height = 100,
  testId,
}: {
  design: DesignNode
  width?: number
  height?: number
  testId?: string
}) {
  const w = typeof design.style?.width === 'number' && design.style.width > 0 ? design.style.width : 800
  const h = typeof design.style?.height === 'number' && design.style.height > 0 ? design.style.height : 600
  const scale = Math.min(width / w, height / h)

  return (
    <div
      className="mt-1 overflow-hidden rounded-md border bg-white"
      style={{ width, height }}
      data-testid={testId}
      data-thumbnail="true"
      aria-hidden="true"
    >
      <div
        style={{
          width: w,
          height: h,
          transform: `scale(${scale})`,
          transformOrigin: '0 0',
          pointerEvents: 'none',
        }}
      >
        <NodeRenderer node={design} selectedIds={EMPTY_SELECTION} decorative />
      </div>
    </div>
  )
}
