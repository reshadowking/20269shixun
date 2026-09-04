import type { ExportElement } from '@/components/canvas/types'
import { escapeHtml } from '@/design/escape'
import { styleToCss } from '@/design/styleToCss'
import type { DesignNode } from '@/design/types'

/** ① 画布渲染：卡片（样式参考 shadcn/ui Card） */
export function CanvasCard({ props, style }: { props: Record<string, unknown>; style?: React.CSSProperties }) {
  const title = typeof props.title === 'string' ? props.title : ''
  const content = typeof props.content === 'string' ? props.content : ''
  return (
    <div className="rounded-lg border bg-card text-card-foreground shadow-sm" style={style as object}>
      <div className="flex flex-col gap-1.5 p-6">
        {title && <div className="text-lg font-semibold">{title}</div>}
        {content && <div className="text-sm text-muted-foreground">{content}</div>}
      </div>
    </div>
  )
}

/** ② props 类型 */
export interface CardProps {
  title?: string
  content?: string
}

/** ③ 导出模板 */
export const exportCardTemplate = (props: Record<string, unknown>): string => {
  const title = escapeHtml(typeof props.title === 'string' ? props.title : '')
  const content = escapeHtml(typeof props.content === 'string' ? props.content : '')
  return `        <div className="rounded-lg border bg-card text-card-foreground shadow-sm">
          <div className="flex flex-col gap-1.5 p-6">
${title ? `            <div className="text-lg font-semibold">${title}</div>` : ''}
${content ? `            <div className="text-sm text-muted-foreground">${content}</div>` : ''}
          </div>
        </div>`
}

/** ④ 属性面板配置 */
export const cardSchema = [
  { key: 'title', label: '标题', control: 'text' as const },
  { key: 'content', label: '内容', control: 'textarea' as const },
]

/** B1：导出语义描述（title → h3、content → p；与引擎 default case 语义一致） */
export const buildCardExport = (node: DesignNode): ExportElement => {
  const props = node.props ?? {}
  const children: ExportElement[] = []
  if (typeof props.title === 'string' && props.title) {
    children.push({ tag: 'h3', attrs: {}, style: {}, text: props.title })
  }
  if (typeof props.content === 'string' && props.content) {
    children.push({ tag: 'p', attrs: {}, style: {}, text: props.content })
  }
  return { tag: 'div', attrs: {}, style: styleToCss(node.style), children }
}
