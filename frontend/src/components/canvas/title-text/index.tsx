import type { ExportElement } from '@/components/canvas/types'
import { TITLE_TEXT_SIZES, TITLE_TEXT_WEIGHT_STYLE } from '@/components/canvas/styleTokens'
import { escapeHtml } from '@/design/escape'
import { styleToCss } from '@/design/styleToCss'
import type { DesignNode } from '@/design/types'

/** ① 画布渲染：标题文本（h1-h6；T12-D 字重/行高/字号内联，画布/导出共用 TITLE_TEXT_*） */
export function CanvasTitleText({ props, style }: { props: Record<string, unknown>; style?: React.CSSProperties }) {
  const text = typeof props.text === 'string' ? props.text : '标题'
  const level = Math.min(6, Math.max(1, typeof props.level === 'number' ? props.level : 2))
  return (
    <div style={{ ...TITLE_TEXT_WEIGHT_STYLE, fontSize: TITLE_TEXT_SIZES[level], ...(style as object) }}>
      {text}
    </div>
  )
}

/** ② props 类型 */
export interface TitleTextProps {
  text?: string
  level?: 1 | 2 | 3 | 4 | 5 | 6
}

/** ③ 导出模板 */
// 已废弃（B5，B1-2 全量迁移后）：导出统一走下方 buildExport（React/HTML 引擎消费）；本字符串模板函数不再被注册表引用，待二期删除。
export const exportTitleTextTemplate = (props: Record<string, unknown>): string => {
  const text = escapeHtml(typeof props.text === 'string' ? props.text : '标题')
  const level = Math.min(6, Math.max(1, typeof props.level === 'number' ? props.level : 2))
  const sizes: Record<number, number> = { 1: 28, 2: 24, 3: 20, 4: 18, 5: 16, 6: 14 }
  return `        <div className="font-semibold leading-tight" style={{ fontSize: ${sizes[level]} }}>
          ${text}
        </div>`
}

/** ④ 属性面板配置 */
export const titleTextSchema = [
  { key: 'text', label: '文本', control: 'textarea' as const },
  { key: 'level', label: '级别', control: 'select' as const, options: ['1', '2', '3', '4', '5', '6'] },
]

/** B1：导出语义描述（level → h1-h6，与引擎 case 一致）。
 * T12-D：字重 600 / 行高 1.25 / margin 0 / 按等级字号与画布共用 TITLE_TEXT_*
 * （此前导出 <h*> 默认 700 + 上下 margin，比画布多出外边距）。 */
export const buildTitleTextExport = (node: DesignNode): ExportElement => {
  const props = node.props ?? {}
  const level = typeof props.level === 'number' && props.level >= 1 && props.level <= 6 ? props.level : 2
  return {
    tag: `h${level}`,
    attrs: {},
    style: { ...TITLE_TEXT_WEIGHT_STYLE, fontSize: TITLE_TEXT_SIZES[level], ...styleToCss(node.style) },
    text: typeof props.text === 'string' ? props.text : '',
  }
}
