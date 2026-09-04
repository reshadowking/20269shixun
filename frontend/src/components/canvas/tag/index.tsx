import type { ExportElement } from '@/components/canvas/types'
import { escapeHtml } from '@/design/escape'
import { styleToCss } from '@/design/styleToCss'
import type { DesignNode } from '@/design/types'

/** ① 画布渲染：标签（样式参考 shadcn/ui Badge） */
export function CanvasTag({ props, style: _style }: { props: Record<string, unknown>; style?: React.CSSProperties }) {
  const text = typeof props.text === 'string' ? props.text : '标签'
  const color = typeof props.color === 'string' ? props.color : 'default'
  const colored = color === 'danger' || color === 'primary' || color === 'success'
  return (
    <span
      className={colored
        ? 'inline-flex items-center rounded-md px-2.5 py-0.5 text-xs font-semibold text-white'
        : 'inline-flex items-center rounded-md bg-secondary px-2.5 py-0.5 text-xs font-semibold text-secondary-foreground'}
      style={colored ? { background: color } : undefined}
      data-testid="canvas-tag"
    >
      {text}
    </span>
  )
}

/** ② props 类型 */
export interface TagProps {
  text?: string
  color?: string
}

/** ③ 导出模板 */
export const exportTagTemplate = (props: Record<string, unknown>): string => {
  const text = escapeHtml(typeof props.text === 'string' ? props.text : '标签')
  const color = typeof props.color === 'string' ? props.color : 'default'
  const colored = color === 'danger' || color === 'primary' || color === 'success'
  return colored
    ? `        <span className="inline-flex items-center rounded-md px-2.5 py-0.5 text-xs font-semibold text-white" style={{ background: '${color}' }}>
          ${text}
        </span>`
    : `        <span className="inline-flex items-center rounded-md bg-secondary px-2.5 py-0.5 text-xs font-semibold text-secondary-foreground">
          ${text}
        </span>`
}

/** ④ 属性面板配置 */
export const tagSchema = [
  { key: 'text', label: '标签文本', control: 'text' as const },
  { key: 'color', label: '颜色', control: 'color' as const },
]

/** B1：导出语义描述（引擎 case 语义：仅文本与样式，无 Tailwind 依赖） */
export const buildTagExport = (node: DesignNode): ExportElement => {
  const props = node.props ?? {}
  return {
    tag: 'span',
    attrs: {},
    style: styleToCss(node.style),
    text: typeof props.text === 'string' ? props.text : '',
  }
}
