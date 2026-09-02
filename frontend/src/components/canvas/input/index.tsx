import { escapeHtml } from '@/design/escape'

/** ① 画布渲染：输入框（样式参考 shadcn/ui Input） */
export function CanvasInput({ props, style }: { props: Record<string, unknown>; style?: React.CSSProperties }) {
  const label = typeof props.label === 'string' ? props.label : ''
  const placeholder = typeof props.placeholder === 'string' ? props.placeholder : ''
  const type = typeof props.type_ === 'string' ? props.type_ : 'text'
  return (
    <div className="flex flex-col gap-1.5" style={style as object}>
      {label && <label className="text-sm font-medium">{label}</label>}
      <input
        type={type}
        placeholder={placeholder}
        disabled={Boolean(props.disabled)}
        readOnly
        className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
      />
    </div>
  )
}

/** ② props 类型 */
export interface InputProps {
  label?: string
  placeholder?: string
  type_?: 'text' | 'password' | 'email' | 'number'
  disabled?: boolean
}

/** ③ 导出模板（props 必须 HTML 转义） */
export const exportInputTemplate = (props: Record<string, unknown>): string => {
  const label = typeof props.label === 'string' ? props.label : ''
  const placeholder = escapeHtml(typeof props.placeholder === 'string' ? props.placeholder : '')
  const type = typeof props.type_ === 'string' ? props.type_ : 'text'
  return `        <div className="flex flex-col gap-1.5">
${label ? `          <label className="text-sm font-medium">${escapeHtml(label)}</label>` : ''}
          <input type="${type}" placeholder="${placeholder}" className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground" />
        </div>`
}

/** ④ 属性面板配置 */
export const inputSchema = [
  { key: 'label', label: '标签文本', control: 'text' as const },
  { key: 'placeholder', label: '占位符', control: 'text' as const },
  { key: 'type_', label: '输入类型', control: 'select' as const, options: ['text', 'password', 'email', 'number'] },
  { key: 'disabled', label: '禁用', control: 'switch' as const },
]
