import { escapeHtml } from '@/design/escape'
import { styleToCss } from '@/design/styleToCss'
import { BUTTON_VARIANT_STYLE, DISABLED_STYLE } from '@/components/canvas/styleTokens'
import type { DesignNode } from '@/design/types'
import type { ExportElement } from '@/components/canvas/types'

/** ① 画布渲染：按钮（样式参考 shadcn/ui Button，自实现 Canvas 版，支持全部 variant）。
 * 导出仅供 B0 契约测试读取合法集合（与组件库/属性面板三方对齐校验）。
 * 色彩改内联（T5-0）：jsdom 不解析 Tailwind 类，内联后画布/导出同源且可测。 */
export const VARIANT_CLASS: Record<string, string> = {
  // hover/active 用 brightness（filter 属性不受内联 background 覆盖影响）；ghost 无底色沿用 bg-accent
  default: 'inline-flex items-center justify-center rounded-md text-sm font-medium shadow-sm cursor-pointer transition hover:brightness-90 active:brightness-80',
  primary: 'inline-flex items-center justify-center rounded-md text-sm font-medium shadow-sm cursor-pointer transition hover:brightness-90 active:brightness-80',
  secondary: 'inline-flex items-center justify-center rounded-md text-sm font-medium shadow-sm cursor-pointer transition hover:brightness-90 active:brightness-80',
  outline: 'inline-flex items-center justify-center rounded-md text-sm font-medium shadow-sm cursor-pointer transition hover:brightness-95 active:brightness-90',
  ghost: 'inline-flex items-center justify-center rounded-md text-sm font-medium cursor-pointer transition hover:bg-accent hover:text-accent-foreground active:bg-accent/80',
  destructive: 'inline-flex items-center justify-center rounded-md text-sm font-medium shadow-sm cursor-pointer transition hover:brightness-90 active:brightness-80',
}

export function CanvasButton({ props, style }: { props: Record<string, unknown>; style?: React.CSSProperties }) {
  const text = typeof props.text === 'string' ? props.text : '按钮'
  const variant = typeof props.variant === 'string' ? props.variant : 'default'
  const size = typeof props.size === 'string' ? props.size : 'default'
  const heightMap: Record<string, number> = { sm: 32, default: 40, lg: 48 }
  const height = style?.height ? undefined : heightMap[size] ?? 40
  const className = VARIANT_CLASS[variant] ?? VARIANT_CLASS.default

  const disabled = Boolean(props.disabled)

  return (
    <div
      className={className}
      style={{
        height,
        paddingLeft: size === 'lg' ? 28 : 16,
        paddingRight: size === 'lg' ? 28 : 16,
        ...(BUTTON_VARIANT_STYLE[variant] ?? BUTTON_VARIANT_STYLE.default),
        // disabled 为静态状态走内联（jsdom 可测、导出同步）；hover/active 是交互态走类
        ...(disabled ? DISABLED_STYLE : {}),
        ...(style as object),
      }}
    >
      {text}
    </div>
  )
}

/** ② props 类型 */
export interface ButtonProps {
  text?: string
  variant?: 'default' | 'primary' | 'secondary' | 'outline' | 'ghost' | 'destructive'
  size?: 'sm' | 'default' | 'lg'
  disabled?: boolean
}

/** ③ 导出模板：字符串拼装，props 必须 HTML 转义 */
// 已废弃（B5，B1-2 全量迁移后）：导出统一走下方 buildExport（React/HTML 引擎消费）；本字符串模板函数不再被注册表引用，待二期删除。
export const exportButtonTemplate = (props: Record<string, unknown>): string => {
  const text = escapeHtml(typeof props.text === 'string' ? props.text : '按钮')
  const variant = typeof props.variant === 'string' ? props.variant : 'default'
  const size = typeof props.size === 'string' ? props.size : 'default'
  const heightMap: Record<string, number> = { sm: 32, default: 40, lg: 48 }
  const className = VARIANT_CLASS[variant] ?? VARIANT_CLASS.default
  return `        <button className="${className}" style={{ height: ${heightMap[size] ?? 40}, paddingLeft: ${size === 'lg' ? 28 : 16}, paddingRight: ${size === 'lg' ? 28 : 16} }}>
          ${text}
        </button>`
}

/** B1 试点：导出语义描述（React/HTML 引擎共用；文本与属性转义由引擎统一负责）。
 * T5-0 #5：变体底色/白字/描边与画布共用 BUTTON_VARIANT_STYLE，node.style 仍可覆盖。 */
export const buildButtonExport = (node: DesignNode): ExportElement => {
  const props = node.props ?? {}
  const variant = typeof props.variant === 'string' ? props.variant : 'default'
  const disabled = Boolean(props.disabled)
  return {
    tag: 'button',
    attrs: disabled ? { disabled: 'disabled' } : {},
    style: {
      ...(BUTTON_VARIANT_STYLE[variant] ?? BUTTON_VARIANT_STYLE.default),
      // disabled 是静态状态，双通道同步；hover/active/focus-visible 是交互态，
      // 静态 HTML 导出不实现——有意为之（className 中的 hover:brightness 等仅在
      // React 工程（带 Tailwind）里生效，HTML 通道由浏览器 disabled 语义兜底）。
      ...(disabled ? DISABLED_STYLE : {}),
      ...styleToCss(node.style),
    },
    text: typeof props.text === 'string' ? props.text : '',
  }
}

/** ④ 属性面板配置 */
export const buttonSchema = [
  { key: 'text', label: '按钮文本', control: 'text' as const },
  { key: 'variant', label: '样式', control: 'select' as const, options: ['default', 'primary', 'secondary', 'outline', 'ghost', 'destructive'] },
  { key: 'size', label: '尺寸', control: 'select' as const, options: ['sm', 'default', 'lg'] },
  { key: 'disabled', label: '禁用', control: 'switch' as const },
]
