import type { ExportElement } from '@/components/canvas/types'
import { escapeHtml } from '@/design/escape'
import { styleToCss } from '@/design/styleToCss'
import { CARD_DEFAULT_STYLE, STAT_LABEL_COLOR } from '@/components/canvas/styleTokens'
import type { DesignNode } from '@/design/types'

/** ① 画布渲染：卡片（样式参考 shadcn/ui Card） */
export function CanvasCard({ props, style }: { props: Record<string, unknown>; style?: React.CSSProperties }) {
  const title = typeof props.title === 'string' ? props.title : ''
  const content = typeof props.content === 'string' ? props.content : ''
  return (
    // 默认观感（边框/圆角/阴影/内边距）内联走 CARD_DEFAULT_STYLE——画布/导出同源；
    // hover 抬升有意不加：卡片是静态容器，导出为静态产物，加 hover 会造成观感分叉
    // （任务卡 §4.2.1）；选中态由画布选中框表达。
    <div style={{ ...CARD_DEFAULT_STYLE, ...(style as object) }}>
      <div className="flex flex-col gap-1.5">
        {title && <div className="text-lg font-semibold">{title}</div>}
        {content && <div className="text-sm" style={{ color: STAT_LABEL_COLOR }}>{content}</div>}
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
// 已废弃（B5，B1-2 全量迁移后）：导出统一走下方 buildExport（React/HTML 引擎消费）；本字符串模板函数不再被注册表引用，待二期删除。
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
  // title/content 字号字重与画布 text-lg font-semibold / text-sm text-muted-foreground 对齐
  if (typeof props.title === 'string' && props.title) {
    children.push({ tag: 'h3', attrs: {}, style: { fontSize: 18, fontWeight: 600, margin: 0, marginBottom: 6 }, text: props.title })
  }
  if (typeof props.content === 'string' && props.content) {
    children.push({ tag: 'p', attrs: {}, style: { fontSize: 14, color: STAT_LABEL_COLOR, margin: 0 }, text: props.content })
  }
  return { tag: 'div', attrs: {}, style: { ...CARD_DEFAULT_STYLE, ...styleToCss(node.style) }, children }
}
