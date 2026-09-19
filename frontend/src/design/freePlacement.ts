/**
 * 自由画布下的**孤儿节点补位**（2026-09-18）。
 *
 * 场景：`autoFreezeAfterAi` 把画布冻成 `layout: free` 之后（生成即可拖），下一次 AI 修改
 * 新增的节点只有 props/style —— 模型看不见"父级是不是 free"，正常不会给 x/y。
 * 渲染侧 `left/top` 为空 → 绝对定位退回**静态位置**，于是新节点压在已有节点上。
 *
 * 实测（E2E `free-orphan-placement.spec.ts` 首次运行）：已有按钮在 (276,192)、
 * 新按钮落在 (268,184)，两者完全重叠。
 *
 * 规则（纯函数，便于单测；也是幂等的——已有坐标一律不动）：
 * - 只处理**父级 `layout === 'free'`** 的容器（flex 有自己的排版，不要插手）；
 * - 只给缺 x/y 的子节点补：x 取父级 padding 左（保住原有横坐标若已给），
 *   y 取"已定位兄弟的最低沿 + gap"（没有任何已定位兄弟时取 padding 上）；
 * - 补完之后若内容超出父容器的**显式**高度，只把高度**改大**（从不缩小），
 *   否则新节点会被冻住的容器裁掉；
 * - 递归处理嵌套容器（外层 free 不代表里层没有孤儿）。
 */
import type { DesignNode } from './types'

const DEFAULT_GAP = 8

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export function placeUnpositionedChildren(node: DesignNode): DesignNode {
  const children = node.children
  if (!children || children.length === 0) return node

  const isFree = node.style?.layout === 'free'
  const pad = num(node.style?.padding) ?? 0
  const gap = num(node.style?.gap) ?? DEFAULT_GAP

  // 已定位兄弟的最低沿：新节点从这里往下排，绝不压已有内容
  let cursor = pad
  if (isFree) {
    for (const child of children) {
      const y = num(child.y)
      if (y === null) continue
      cursor = Math.max(cursor, y + (num(child.style?.height) ?? 0) + gap)
    }
  }

  let placedAny = false
  const next = children.map((child) => {
    let out = child
    if (isFree && (num(child.x) === null || num(child.y) === null)) {
      const x = num(child.x) ?? pad
      const y = num(child.y) ?? cursor
      out = { ...child, x, y }
      cursor = y + (num(out.style?.height) ?? 0) + gap
      placedAny = true
    }
    return placeUnpositionedChildren(out)
  })

  const changed = placedAny || next.some((child, index) => child !== children[index])
  if (!changed) return node

  let style = node.style
  if (isFree && style) {
    const height = num(style.height)
    const needed = Math.max(
      ...next.map((child) => (num(child.y) ?? 0) + (num(child.style?.height) ?? 0) + pad),
    )
    if (height !== null && needed > height) style = { ...style, height: Math.round(needed) }
  }
  return { ...node, style, children: next }
}
