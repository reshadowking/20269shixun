import type { CSSProperties } from 'react'

import type { ExportElement } from '@/components/canvas/types'
import { escapeHtml } from '@/design/escape'
import { styleToCss } from '@/design/styleToCss'
import {
  TABLE_CELL_BORDER,
  TABLE_HEAD_BACKGROUND,
  TABLE_HEAD_TEXT_COLOR,
} from '@/components/canvas/styleTokens'
import type { DesignNode } from '@/design/types'

interface TableColumn { key?: string; title?: string }
interface TableRow { [key: string]: unknown }

/** ① 画布渲染：表格（样式参考 shadcn/ui Table） */
export function CanvasTable({ props, style }: { props: Record<string, unknown>; style?: React.CSSProperties }) {
  const columns = Array.isArray(props.columns) ? (props.columns as TableColumn[]) : []
  const rows = Array.isArray(props.rows) ? (props.rows as TableRow[]) : []
  return (
    <div className="w-full rounded-lg border bg-card" style={style as object}>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b" style={{ borderBottom: TABLE_CELL_BORDER, background: TABLE_HEAD_BACKGROUND }}>
            {columns.map((col, i) => (
              <th key={i} className="px-4 py-3 text-left font-medium" style={{ color: TABLE_HEAD_TEXT_COLOR }}>
                {escapeHtml(col.title ?? col.key ?? '')}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="last:border-0" style={{ borderBottom: i < rows.length - 1 ? TABLE_CELL_BORDER : undefined }}>
              {columns.map((col, j) => {
                const key = col.key ?? ''
                const value = key ? row[key] : ''
                return (
                  <td key={j} className="px-4 py-3">
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
  { key: 'columns', label: '列（JSON 数组）', control: 'textarea' as const },
  { key: 'rows', label: '行数据（JSON 数组）', control: 'textarea' as const },
]

/** B1：导出语义描述——thead/tbody 结构与引擎 case 一致（单元格边框常量统一） */
export const buildTableExport = (node: DesignNode): ExportElement => {
  const props = node.props ?? {}
  const columns = Array.isArray(props.columns) ? (props.columns as TableColumn[]) : []
  const rows = Array.isArray(props.rows) ? (props.rows as TableRow[]) : []
  const cellStyle: CSSProperties = { border: TABLE_CELL_BORDER, padding: 8 }
  const headRow: ExportElement = {
    tag: 'tr',
    attrs: {},
    style: {},
    children: columns.map((c) => ({
      tag: 'th',
      attrs: {},
      style: { ...cellStyle, background: TABLE_HEAD_BACKGROUND, color: TABLE_HEAD_TEXT_COLOR },
      text: typeof c.title === 'string' ? c.title : '',
    })),
  }
  const bodyRows: ExportElement[] = rows.map((r) => ({
    tag: 'tr',
    attrs: {},
    style: {},
    children: columns.map((c) => {
      const key = typeof c.key === 'string' ? c.key : ''
      const v = key ? r[key] : undefined
      return { tag: 'td', attrs: {}, style: cellStyle, text: v == null ? '' : String(v) }
    }),
  }))
  return {
    tag: 'table',
    attrs: {},
    style: { ...styleToCss(node.style), borderCollapse: 'collapse', width: '100%' },
    children: [
      { tag: 'thead', attrs: {}, style: {}, children: [headRow] },
      { tag: 'tbody', attrs: {}, style: {}, children: bodyRows },
    ],
  }
}
