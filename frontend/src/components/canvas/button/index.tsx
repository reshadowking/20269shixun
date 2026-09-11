import { escapeHtml } from '@/design/escape'
import { resolveColor, styleToCss } from '@/design/styleToCss'
import type { DesignNode } from '@/design/types'
import type { ExportElement } from '@/components/canvas/types'

/**
 * 变体底色（T5-0 #5 修复）：画布与导出共用同一映射——底色/描边取 design-system.yaml
 * 令牌，填充上的文字统一白（shadcn 主题三处 --*-foreground 均为 #ffffff，令牌表
 * 无对应项，收敛为常量）。此前导出 builder 只输出 node.style，变体底色整体丢失，
 * 导出工程里"按钮没颜色"。
 */
export const BUTTON_VARIANT_STYLE: Record<string, React.CSSProperties> = {
  default: { background: resolveColor('primary'), color: '#FFFFFF' },
  primary: { background: resolveColor('primary'), color: '#FFFFFF' },
  secondary: { background: resolveColor('secondary'), color: '#FFFFFF' },
  outline: { background: '#FFFFFF', border: `1px solid ${resolveColor('border')}` },
  ghost: {},
  destructive: { background: resolveColor('danger'), color: '#FFFFFF' },
}

/** ① 画布渲染：按钮（样式参考 shadcn/ui Button，自实现 Canvas 版，支持全部 variant）。
 * 导出仅供 B0 契约测试读取合法集合（与组件库/属性面板三方对齐校验）。
 * 色彩改内联（T5-0）：jsdom 不解析 Tailwind 类，内联后画布/导出同源且可测。 */
export const VARIANT_CLASS: Record<string, string> = {
  default: 'inline-flex items-center justify-center rounded-md text-sm font-medium shadow-sm',
  primary: 'inline-flex items-center justify-center rounded-md text-sm font-medium shadow-sm',
  secondary: 'inline-flex items-center justify-center rounded-md text-sm font-medium shadow-sm',
  outline: 'inline-flex items-center justify-center rounded-md text-sm font-medium shadow-sm',
  ghost: 'inline-flex items-center justify-center rounded-md text-sm font-medium hover:bg-accent hover:text-accent-foreground',
  destructive: 'inline-flex items-center justify-center rounded-md text-sm font-medium shadow-sm',
}

export function CanvasButton({ props, style }: { props: Record<string, unknown>; style?: React.CSSProperties }) {
  const text = typeof props.text === 'string' ? props.text : '按钮'
  const variant = typeof props.variant === 'string' ? props.variant : 'default'
  const size = typeof props.size === 'string' ? props.size : 'default'
  const heightMap: Record<string, number> = { sm: 32, default: 40, lg: 48 }
  const height = style?.height ? undefined : heightMap[size] ?? 40
  const className = VARIANT_CLASS[variant] ?? VARIANT_CLASS.default

  return (
    <div
      className={className}
      style={{
        height,
        paddingLeft: size === 'lg' ? 28 : 16,
        paddingRight: size === 'lg' ? 28 : 16,
        ...(BUTTON_VARIANT_STYLE[variant] ?? BUTTON_VARIANT_STYLE.default),
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
  return {
    tag: 'button',
    attrs: {},
    style: {
      ...(BUTTON_VARIANT_STYLE[variant] ?? BUTTON_VARIANT_STYLE.default),
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
]
