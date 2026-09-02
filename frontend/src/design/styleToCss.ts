/**
 * DesignNode style → CSS style 转换（P0-2 修复：radius/borderRadius 等键名映射）。
 * NodeRenderer（包裹层）与组件 Canvas（内部层）共用同一转换，保证圆角等属性
 * 正确应用到"组件本身有背景色的那一层"。
 */
import type { CSSProperties } from 'react'

import { colorValue } from '@/design/tokens.generated'
import type { NodeStyle } from '@/design/types'

const THEME = 'default' as const

/** 令牌解析：style 里的 token 名 → 色值；非令牌值原样返回 */
export function resolveColor(value: string | undefined): string | undefined {
  if (!value) return undefined
  return colorValue(THEME, value) ?? value
}

function toCssSize(v: number | string | undefined): string | undefined {
  if (v === undefined) return undefined
  return typeof v === 'number' ? `${v}px` : v
}

/** 已知样式字段 → CSS 属性映射（设计键名 → React CSS 键名） */
const CSS_KEY_MAP: Record<string, string> = {
  justify: 'justifyContent',
  alignItems: 'alignItems',
  align: 'textAlign',
  fontWeight: 'fontWeight',
  fontSize: 'fontSize',
  flex: 'flex',
  border: 'border',
  textDecoration: 'textDecoration',
}

/** DesignNode style → React CSSProperties（组件内部透传也用它） */
export function styleToCss(style: NodeStyle | undefined): CSSProperties {
  const s: CSSProperties = {}
  if (!style) return s
  const { layout, gap, color, background, radius, width, height, spacing, backgroundImage, ...rest } = style

  if (layout === 'free') {
    // free 容器自身作为子节点绝对定位的上下文
    s.position = 'relative'
  } else if (layout === 'row' || layout === 'column') {
    s.display = 'flex'
    s.flexDirection = layout
    s.gap = gap ?? 0
  } else if (layout === 'grid') {
    s.display = 'grid'
    s.gap = gap ?? 0
  }
  if (color) s.color = resolveColor(color)
  if (background) s.background = resolveColor(background)
  if (radius !== undefined) s.borderRadius = radius
  if (width !== undefined) s.width = toCssSize(width)
  if (height !== undefined) s.height = toCssSize(height)
  if (spacing !== undefined) s.padding = spacing
  if (backgroundImage) {
    // 背景图 URL 协议白名单（http/https/data:image），防 CSS 注入
    const url = String(backgroundImage)
    if (/^(https?:|data:image\/)/i.test(url)) {
      s.backgroundImage = `url("${url.replace(/"/g, '%22')}")`
      s.backgroundSize = 'cover'
      s.backgroundPosition = 'center'
    }
  }
  // 其余已知样式字段透传
  for (const [k, v] of Object.entries(rest)) {
    const cssKey = CSS_KEY_MAP[k]
    if (cssKey && v !== undefined) (s as Record<string, unknown>)[cssKey] = v
  }
  return s
}
