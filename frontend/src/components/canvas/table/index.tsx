import type { ExportElement } from '@/components/canvas/types'
import { escapeHtml } from '@/design/escape'
import { styleToCss } from '@/design/styleToCss'
import {
  TABLE_CELL_STYLE,
  TABLE_CONTAINER_STYLE,
  TABLE_HEAD_BACKGROUND,
  TABLE_HEAD_CELL_STYLE,
  TABLE_HEAD_TEXT_COLOR,
  TABLE_ROW_BORDER,
} from '@/components/canvas/styleTokens'
import type { DesignNode } from '@/design/types'

interface TableColumn { key?: string; title?: string }
interface TableRow { [key: string]: unknown }

/** ① 画布渲染：表格（样式参考 shadcn/ui Table） */
export function CanvasTable({ props, style }: { props: Record<string, unknown>; style?: React.CSSProperties }) {
  const columns = Array.isArray(props.columns) ? (props.columns as TableColumn[]) : []
  const rows = Array.isArray(props.rows) ? (props.rows as TableRow[]) : []
  return (
    // 静态观感内联（T12-C，画布/导出共用 TABLE_* 常量）；表头底色/文字色/边框沿用 T5-A 令牌
    <div style={{ ...TABLE_CONTAINER_STYLE, ...(style as object) }}>
      <table style={{ width: '100%', fontSize: 14, borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ ...TABLE_ROW_BORDER, background: TABLE_HEAD_BACKGROUND }}>
            {columns.map((col, i) => (
              <th key={i} style={{ ...TABLE_CELL_STYLE, ...TABLE_HEAD_CELL_STYLE, color: TABLE_HEAD_TEXT_COLOR }}>
                {escapeHtml(col.title ?? col.key ?? '')}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} style={i < rows.length - 1 ? { ...TABLE_ROW_BORDER } : undefined}>
              {columns.map((col, j) => {
                const key = col.key ?? ''
                const value = key ? row[key] : ''
                return (
                  <td key={j} style={{ ...TABLE_CELL_STYLE }}>
                    {escapeHtml(String(value ?? ''))}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** ② props 类型 */
export interface TableProps {
  columns?: TableColumn[]
  rows?: TableRow[]
}

/** ③ 导出模板 */
// 已废弃（B5，B1-2 全量迁移后）：导出统一走下方 buildExport（React/HTML 引擎消费）；本字符串模板函数不再被注册表引用，待二期删除。
export const exportTableTemplate = (props: Record<string, unknown>): string => {
  const columns = Array.isArray(props.columns) ? (props.columns as TableColumn[]) : []
  const rows = Array.isArray(props.rows) ? (props.rows as TableRow[]) : []
  return `        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50">
${columns.map((col) => `              <th className="px-4 py-3 text-left font-medium text-muted-foreground">${escapeHtml(col.title ?? col.key ?? '')}</th>`).join('\n')}
            </tr>
          </thead>
          <tbody>
${rows.map((row) => `            <tr className="border-b">
${columns.map((col) => `              <td className="px-4 py-3">${escapeHtml(String((col.key ? row[col.key] : '') ?? ''))}</td>`).join('\n')}
            </tr>`).join('\n')}
          </tbody>
        </table>`
}

/** ④ 属性面板配置 */
export const tableSchema = [
  { key: 'columns', label: '列（JSON 数组）', control: 'json' as const },
  { key: 'rows', label: '行数据（JSON 数组）', control: 'json' as const },
]

/** B1：导出语义描述——thead/tbody 结构与引擎 case 一致（单元格边框常量统一）。
 * T12-C：容器观感（圆角 8 / border 令牌 / 白底）与单元格 padding 16×12、表头左对齐·500
 * 补齐并与画布共用 TABLE_* 常量；容器由外层 div 落到 table 本身承载（结构差异见常量注释），
 * 单元格不再各带边框——行分隔线走行容器，与画布 tr border-b（末行无）语义一致。 */
export const buildTableExport = (node: DesignNode): ExportElement => {
  const props = node.props ?? {}
  const columns = Array.isArray(props.columns) ? (props.columns as TableColumn[]) : []
  const rows = Array.isArray(props.rows) ? (props.rows as TableRow[]) : []
  const headRow: ExportElement = {
    tag: 'tr',
    attrs: {},
    style: { ...TABLE_ROW_BORDER, background: TABLE_HEAD_BACKGROUND },
    children: columns.map((c) => ({
      tag: 'th',
      attrs: {},
      style: { ...TABLE_CELL_STYLE, ...TABLE_HEAD_CELL_STYLE, color: TABLE_HEAD_TEXT_COLOR },
      text: typeof c.title === 'string' ? c.title : '',
    })),
  }
  const bodyRows: ExportElement[] = rows.map((r, i) => ({
    tag: 'tr',
    attrs: {},
    style: i < rows.length - 1 ? { ...TABLE_ROW_BORDER } : {},
    children: columns.map((c) => {
      const key = typeof c.key === 'string' ? c.key : ''
      const v = key ? r[key] : undefined
      return { tag: 'td', attrs: {}, style: { ...TABLE_CELL_STYLE }, text: v == null ? '' : String(v) }
    }),
  }))
  return {
    tag: 'table',
    attrs: {},
    style: { ...TABLE_CONTAINER_STYLE, borderCollapse: 'collapse', ...styleToCss(node.style) },
    children: [
      { tag: 'thead', attrs: {}, style: {}, children: [headRow] },
      { tag: 'tbody', attrs: {}, style: {}, children: bodyRows },
    ],
  }
}
