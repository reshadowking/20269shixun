import { escapeHtml } from '@/design/escape'

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
          <tr className="border-b bg-muted/50">
            {columns.map((col, i) => (
              <th key={i} className="px-4 py-3 text-left font-medium text-muted-foreground">
                {escapeHtml(col.title ?? col.key ?? '')}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b last:border-0">
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
