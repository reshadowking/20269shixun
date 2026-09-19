/**
 * DesignNode style → CSS style 转换（P0-2 修复：radius/borderRadius 等键名映射）。
 * NodeRenderer（包裹层）与组件 Canvas（内部层）共用同一转换，保证圆角等属性
 * 正确应用到"组件本身有背景色的那一层"。
 *
 * T49（C2）：入口先按 `styleKeys` 的别名表归一（boxShadow→shadow、borderRadius→radius…）。
 * 起因：模型经常写近义键，而下面只透传 `CSS_KEY_MAP` 里的固定键 —— 于是"改了、计数了、
 * 画布不动"。归一把这类写法接住；仍不可渲染的键由变更清单如实标注（不在这里假装成功）。
 */
import type { CSSProperties } from 'react'

import { colorValue, THEMES } from '@/design/tokens.generated'
import type { NodeStyle } from '@/design/types'

import { normalizeStyleKeys } from './styleKeys'

const THEME = 'default' as const

/** 令牌名清单（属性面板颜色输入的自动补全源）；色值合规判断用 isAllowedColor（tokens.generated） */
export const DESIGN_TOKEN_NAMES: readonly string[] = Object.keys(THEMES[THEME].colors)

/** 非令牌、非 hex 但合法的 CSS 颜色关键词（直通，不当成"拼错的令牌"处理） */
const CSS_COLOR_PASSTHROUGH = new Set(['transparent', 'none', 'inherit', 'currentcolor'])

/** 是否为合法 CSS 颜色关键词。PropertyPanel 提示的豁免条件：这类值 resolveColor 放行
 * （可渲染），但 isAllowedColor（规范策略）会拒——两个函数职责不同，豁免是有意分歧。 */
export function isCssColorKeyword(value: string): boolean {
  return CSS_COLOR_PASSTHROUGH.has(value.toLowerCase())
}

/** 令牌名是否存在于令牌表（调用方预检/属性面板校验用） */
export function isKnownToken(value: string): boolean {
  return colorValue(THEME, value) !== undefined
}

/**
 * 令牌解析：token 名 → 色值。
 *
 * T52 批2（"未知令牌静默失效"修复）：未知**裸词**不再原样返回——那是静默失效的根源
 * （demoData 曾写 'card'：令牌表无此名 → background: card 非法 CSS → 色块隐形且无任何报错）。
 * 按值形态分流：令牌 → 解析；#hex / 函数值（渐变等）/ CSS 关键词 → 原样放行（合法 CSS）；
 * 其余（想写令牌但拼错了）→ dev 环境 console.warn + 返回 undefined（该字段不生效——显式失败，
 * 不再画布上静默隐形）。
 */
export function resolveColor(value: string | undefined): string | undefined {
  if (!value) return undefined
  const token = colorValue(THEME, value)
  if (token !== undefined) return token
  if (value.startsWith('#') || value.includes('(') || CSS_COLOR_PASSTHROUGH.has(value.toLowerCase())) {
    return value
  }
  if (import.meta.env.DEV) {
    console.warn(
      `[resolveColor] 未知令牌 "${value}"：令牌表无此名，该样式字段将不生效（合法值：令牌名 / #hex / 渐变等函数值）`,
    )
  }
  return undefined
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
  // TODO(T52): shadow 值里的颜色位无令牌校验（如 '0 0 4px badtoken'——badtoken 静默失效），
  // 与 resolveColor 未知值静默放行同根因，只是入口不同；待台账数据排序后批处理。
  shadow: 'boxShadow',
  transform: 'transform',
  // T49（C5）玻璃与质感：背景模糊 / 整体滤镜 / 不透明度
  backdropFilter: 'backdropFilter',
  filter: 'filter',
  opacity: 'opacity',
}

/** 函数型样式值（需做注入形状校验的键） */
const FUNCTION_VALUE_KEYS = ['transform', 'backdropFilter', 'filter'] as const

/**
 * 入场动效预置（缺陷 3）：只写 name 会因缺少时长而不生效，这里补全为完整 animation 值。
 * 关键帧定义见 index.css；非预置名字一律忽略（白名单外的值不渲染）。
 */
const ANIMATION_PRESETS: Record<string, string> = {
  'fade-in': 'fade-in 0.6s ease-out both',
  'rise-in': 'rise-in 0.6s ease-out both',
  'pulse-soft': 'pulse-soft 2.4s ease-in-out infinite',
}

/**
 * 变换/渐变/滤镜等富样式值的形状校验（拒绝分号/花括号/引号等注入向量）。
 *
 * T49：允许**空格分隔的函数链**（`blur(24px) saturate(140%)`、`translateY(-4px) scale(1.02)`）——
 * 滤镜链是合法且常见的写法；单个函数的旧写法仍然通过。分号/花括号/引号一律拒绝。
 */
const SAFE_FN_VALUE = /^[a-z][a-z-]*\([^;{}"'<>\\]*\)(?:\s+[a-z][a-z-]*\([^;{}"'<>\\]*\))*$/i

/** DesignNode style → React CSSProperties（组件内部透传也用它） */
export function styleToCss(style: NodeStyle | undefined): CSSProperties {
  const s: CSSProperties = {}
  if (!style) return s
  // T49：先按别名归一 —— 不归一的话，模型写的 boxShadow/borderRadius/backgroundColor
  // 会在下面的白名单透传里被**静默丢弃**（改了却看不见）
  const normalized = normalizeStyleKeys(style) as NodeStyle
  const { layout, gap, color, background, radius, width, height, spacing, padding, backgroundImage, animation, ...rest } = normalized

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
  // 函数型样式值统一做注入形状校验（transform / backdropFilter / filter）
  for (const key of FUNCTION_VALUE_KEYS) {
    if (rest[key] !== undefined && !SAFE_FN_VALUE.test(String(rest[key]))) {
      delete rest[key]
    }
  }
  // 其余已知样式字段透传
  for (const [k, v] of Object.entries(rest)) {
    const cssKey = CSS_KEY_MAP[k]
    if (cssKey && v !== undefined) (s as Record<string, unknown>)[cssKey] = v
  }
  // Safari/旧 WebKit 需要带前缀的 backdrop-filter
  if (s.backdropFilter) {
    ;(s as Record<string, unknown>).WebkitBackdropFilter = s.backdropFilter
  }
  return s
}
