import { escapeHtml } from '@/design/escape'

/** ① 画布渲染：按钮（样式参考 shadcn/ui Button，自实现 Canvas 版，支持全部 variant） */
const VARIANT_CLASS: Record<string, string> = {
  default: 'inline-flex items-center justify-center rounded-md bg-primary text-sm font-medium text-primary-foreground shadow-sm',
  primary: 'inline-flex items-center justify-center rounded-md bg-primary text-sm font-medium text-primary-foreground shadow-sm',
  secondary: 'inline-flex items-center justify-center rounded-md bg-secondary text-sm font-medium text-secondary-foreground shadow-sm',
  outline: 'inline-flex items-center justify-center rounded-md border border-input bg-background text-sm font-medium shadow-sm',
  ghost: 'inline-flex items-center justify-center rounded-md text-sm font-medium hover:bg-accent hover:text-accent-foreground',
  destructive: 'inline-flex items-center justify-center rounded-md bg-destructive text-sm font-medium text-destructive-foreground shadow-sm',
  link: 'inline-flex items-center justify-center text-sm font-medium text-primary underline-offset-4 hover:underline',
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
      style={{ height, paddingLeft: size === 'lg' ? 28 : 16, paddingRight: size === 'lg' ? 28 : 16, ...(style as object) }}
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

/** ④ 属性面板配置 */
export const buttonSchema = [
  { key: 'text', label: '按钮文本', control: 'text' as const },
  { key: 'variant', label: '样式', control: 'select' as const, options: ['default', 'primary', 'secondary', 'outline', 'ghost', 'destructive'] },
  { key: 'size', label: '尺寸', control: 'select' as const, options: ['sm', 'default', 'lg'] },
]
