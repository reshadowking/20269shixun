import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

import type { ExportElement } from '@/components/canvas/types'
import { escapeHtml } from '@/design/escape'
import { styleToCss } from '@/design/styleToCss'
import type { DesignNode } from '@/design/types'

const CHART_COLORS = ['#0052D9', '#7C4DFF', '#00A870', '#E5352B', '#FF6B6B']

interface ChartDatum { [key: string]: unknown }

/** ① 画布渲染：图表（Recharts 真实渲染 line/bar/pie，v2.2 §5.2） */
export function CanvasChart({ props, style }: { props: Record<string, unknown>; style?: React.CSSProperties }) {
  const chartType = typeof props.chartType === 'string' ? props.chartType : 'bar'
  const title = typeof props.title === 'string' ? props.title : ''
  const data = (Array.isArray(props.data) ? props.data : []) as ChartDatum[]
  const xKey = typeof props.xKey === 'string' ? props.xKey : 'x'
  const yKey = typeof props.yKey === 'string' ? props.yKey : 'y'

  return (
    <div className="w-full rounded-lg border bg-card p-4" data-testid="canvas-chart" style={style as object}>
      {title && <div className="mb-4 text-sm font-semibold">{title}</div>}
      <ResponsiveContainer width="100%" height={180}>
        {chartType === 'line' ? (
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="#E5E8EF" />
            <XAxis dataKey={xKey} tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip />
            <Line type="monotone" dataKey={yKey} stroke="#0052D9" strokeWidth={2} />
          </LineChart>
        ) : chartType === 'pie' ? (
          <PieChart>
            <Pie data={data} dataKey={yKey} nameKey={xKey} outerRadius={70} label>
              {data.map((_, i) => (
                <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
              ))}
            </Pie>
            <Tooltip />
          </PieChart>
        ) : (
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="#E5E8EF" />
            <XAxis dataKey={xKey} tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip />
            <Bar dataKey={yKey} fill="#0052D9" radius={[4, 4, 0, 0]} />
          </BarChart>
        )}
      </ResponsiveContainer>
    </div>
  )
}

/** ② props 类型 */
export interface ChartProps {
  chartType?: 'line' | 'bar' | 'pie'
  title?: string
  data?: ChartDatum[]
  xKey?: string
  yKey?: string
}

/** ③ 导出模板：Recharts 代码（含 import 说明；data 序列化为字面量） */
export const exportChartTemplate = (props: Record<string, unknown>): string => {
  const chartType = typeof props.chartType === 'string' ? props.chartType : 'bar'
  const title = escapeHtml(typeof props.title === 'string' ? props.title : '')
  const data = (Array.isArray(props.data) ? props.data : []) as ChartDatum[]
  const xKey = typeof props.xKey === 'string' ? props.xKey : 'x'
  const yKey = typeof props.yKey === 'string' ? props.yKey : 'y'
  const dataLiteral = JSON.stringify(data)
    .replace(/</g, '\\u003c') // JSON 里的 < 转义，防注入
  const importNote = `// 依赖：npm install recharts`
  const body =
    chartType === 'line'
      ? `        <LineChart data={data}>\n          <XAxis dataKey="${xKey}" />\n          <YAxis />\n          <Tooltip />\n          <Line type="monotone" dataKey="${yKey}" stroke="#0052D9" strokeWidth={2} />\n        </LineChart>`
      : chartType === 'pie'
        ? `        <PieChart>\n          <Pie data={data} dataKey="${yKey}" nameKey="${xKey}" outerRadius={70} label />\n          <Tooltip />\n        </PieChart>`
        : `        <BarChart data={data}>\n          <XAxis dataKey="${xKey}" />\n          <YAxis />\n          <Tooltip />\n          <Bar dataKey="${yKey}" fill="#0052D9" radius={[4, 4, 0, 0]} />\n        </BarChart>`
  return `        <div className="w-full rounded-lg border bg-card p-4">
${title ? `          <div className="mb-4 text-sm font-semibold">${title}</div>` : ''}
          <ResponsiveContainer width="100%" height={180}>
${body}
          </ResponsiveContainer>
        </div>
        {/* ${importNote} */}
        {/* data = ${dataLiteral} */}`
}

/** ④ 属性面板配置 */
export const chartSchema = [
  { key: 'chartType', label: '图表类型', control: 'select' as const, options: ['line', 'bar', 'pie'] },
  { key: 'title', label: '标题', control: 'text' as const },
  { key: 'xKey', label: 'X 轴字段', control: 'text' as const },
  { key: 'yKey', label: 'Y 轴字段', control: 'text' as const },
  { key: 'data', label: '数据（JSON 数组）', control: 'textarea' as const },
]

/** B1：导出语义描述——纯 CSS 柱状示意（与引擎 case 一致；画布为 Recharts 真实渲染） */
export const buildChartExport = (node: DesignNode): ExportElement => {
  const props = node.props ?? {}
  const data = (Array.isArray(props.data) ? props.data : []) as ChartDatum[]
  const xKey = typeof props.xKey === 'string' ? props.xKey : 'name'
  const yKey = typeof props.yKey === 'string' ? props.yKey : 'value'
  const max = Math.max(1, ...data.map((d) => Number(d[yKey]) || 0))
  const children: ExportElement[] = [
    {
      tag: 'div',
      attrs: {},
      style: { fontSize: 14, fontWeight: 600, marginBottom: 12 },
      text: typeof props.title === 'string' ? props.title : '',
    },
  ]
  const bars: ExportElement[] = data.map((d) => ({
    tag: 'div',
    attrs: { title: `${String(d[xKey] ?? '')}: ${String(d[yKey] ?? '')}` },
    style: {
      flex: 1,
      background: '#3D7FFF',
      borderRadius: '4px 4px 0 0',
      height: Math.round(((Number(d[yKey]) || 0) / max) * 140),
    },
  }))
  children.push({
    tag: 'div',
    attrs: {},
    style: { display: 'flex', alignItems: 'flex-end', gap: 12, height: 160 },
    children: bars,
  })
  children.push({
    tag: 'div',
    attrs: {},
    style: { display: 'flex', gap: 12, marginTop: 8 },
    children: data.map((d) => ({
      tag: 'span',
      attrs: {},
      style: { flex: 1, textAlign: 'center', fontSize: 11, color: '#86909C' },
      text: String(d[xKey] ?? ''),
    })),
  })
  return { tag: 'div', attrs: {}, style: styleToCss(node.style), children }
}
