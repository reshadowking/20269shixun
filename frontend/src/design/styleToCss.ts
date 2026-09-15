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
  // 缺陷 3 高级效果：阴影与变换
  shadow: 'boxShadow',
  transform: 'transform',
}

/**
 * 入场动效预置（缺陷 3）：只写 name 会因缺少时长而不生效，这里补全为完整 animation 值。
 * 关键帧定义见 index.css；非预置名字一律忽略（白名单外的值不渲染）。
 */
const ANIMATION_PRESETS: Record<string, string> = {
  'fade-in': 'fade-in 0.6s ease-out both',
  'rise-in': 'rise-in 0.6s ease-out both',
  'pulse-soft': 'pulse-soft 2.4s ease-in-out infinite',
}

/** 变换/渐变等富样式值的形状校验（拒绝分号/花括号/引号等注入向量） */
const SAFE_FN_VALUE = /^[a-z][a-z-]*\([^;{}"'<>\\]*\)$/i

/** DesignNode style → React CSSProperties（组件内部透传也用它） */
export function styleToCss(style: NodeStyle | undefined): CSSProperties {
  const s: CSSProperties = {}
  if (!style) return s
  const { layout, gap, color, background, radius, width, height, spacing, padding, backgroundImage, animation, ...rest } = style

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
  // 内边距双键兼容：padding 优先（模板/组件库/优化器实际使用键），spacing 回退（schema 旧键）
  if (padding !== undefined) s.padding = padding
  else if (spacing !== undefined) s.padding = spacing
  if (backgroundImage) {
    const url = String(backgroundImage)
    if (/^(https?:|data:image\/)/i.test(url)) {
      // 背景图 URL 协议白名单（http/https/data:image），防 CSS 注入
      s.backgroundImage = `url("${url.replace(/"/g, '%22')}")`
      s.backgroundSize = 'cover'
      s.backgroundPosition = 'center'
    } else if (/^(linear|radial|conic)-gradient\(/i.test(url) && SAFE_FN_VALUE.test(url)) {
      // 缺陷 3：渐变背景（白名单预置值，仍做形状校验）
      s.backgroundImage = url
      s.backgroundSize = 'cover'
      s.backgroundPosition = 'center'
    }
  }
  if (animation && ANIMATION_PRESETS[String(animation)]) {
    s.animation = ANIMATION_PRESETS[String(animation)]
  }
  // transform 走 rest 分支的 CSS_KEY_MAP；此处补形状校验，拒绝注入值
  if (rest.transform !== undefined && !SAFE_FN_VALUE.test(String(rest.transform))) {
    delete rest.transform
  }
  // 其余已知样式字段透传
  for (const [k, v] of Object.entries(rest)) {
    const cssKey = CSS_KEY_MAP[k]
    if (cssKey && v !== undefined) (s as Record<string, unknown>)[cssKey] = v
  }
  return s
}
