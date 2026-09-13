import type { ExportElement } from '@/components/canvas/types'
import { escapeHtml } from '@/design/escape'
import { styleToCss } from '@/design/styleToCss'
import { INPUT_LABEL_COLOR } from '@/components/canvas/styleTokens'
import type { DesignNode } from '@/design/types'

/** ① 画布渲染：输入框（样式参考 shadcn/ui Input） */
export function CanvasInput({ props, style }: { props: Record<string, unknown>; style?: React.CSSProperties }) {
  const label = typeof props.label === 'string' ? props.label : ''
  const placeholder = typeof props.placeholder === 'string' ? props.placeholder : ''
  const type = typeof props.type_ === 'string' ? props.type_ : 'text'
  return (
    <div className="flex flex-col gap-1.5" style={style as object}>
      {label && <label className="text-sm font-medium" style={{ color: INPUT_LABEL_COLOR }}>{label}</label>}
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
// 已废弃（B5，B1-2 全量迁移后）：导出统一走下方 buildExport（React/HTML 引擎消费）；本字符串模板函数不再被注册表引用，待二期删除。
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

/** B1：导出语义描述——wrapper div 携带设计 style；label/type_/disabled 与画布一致（双通道同构） */
export const buildInputExport = (node: DesignNode): ExportElement => {
  const props = node.props ?? {}
  const children: ExportElement[] = []
  if (typeof props.label === 'string' && props.label) {
    children.push({
      tag: 'label',
      attrs: {},
      style: { display: 'block', fontSize: 13, color: INPUT_LABEL_COLOR, marginBottom: 6 },
      text: props.label,
    })
  }
  const attrs: Record<string, string> = {
    type: typeof props.type_ === 'string' ? props.type_ : 'text',
    placeholder: typeof props.placeholder === 'string' ? props.placeholder : '',
  }
  if (props.disabled) attrs.disabled = 'disabled'
  children.push({ tag: 'input', attrs, style: {} })
  return { tag: 'div', attrs: {}, style: styleToCss(node.style), children }
}
