import type { ExportElement } from '@/components/canvas/types'
import { escapeHtml } from '@/design/escape'
import { resolveColor, styleToCss } from '@/design/styleToCss'
import { STAT_CONTAINER_STYLE, STAT_LABEL_STYLE, STAT_TREND_STYLE, STAT_VALUE_STYLE } from '@/components/canvas/styleTokens'
import type { DesignNode } from '@/design/types'

/**
 * 趋势色（T3 修复）：画布与导出共用同一令牌（design-system.yaml 唯一规范源）——
 * 涨 = success、跌 = danger。此前画布用 Tailwind emerald/rose 类、导出硬编码
 * success 的十六进制值，两侧各自实现导致「↓ 在导出里恒为绿色」的 parity 破洞。
 */
function trendColor(trend: string): string | undefined {
  return resolveColor(trend.startsWith('↑') ? 'success' : 'danger')
}

/** ① 画布渲染：指标块（label/value/trend，样式参考 shadcn/ui Card + 数字） */
export function CanvasStatBlock({ props, style }: { props: Record<string, unknown>; style?: React.CSSProperties }) {
  const label = typeof props.label === 'string' ? props.label : '指标'
  const value = typeof props.value === 'string' ? props.value : '0'
  const trend = typeof props.trend === 'string' ? props.trend : ''
  return (
    // 容器默认观感内联（T12-D）；三块内容配方共用 STAT_* 常量（T13 #26 对齐）
    <div style={{ ...STAT_CONTAINER_STYLE, ...(style as object) }}>
      <div style={{ ...STAT_LABEL_STYLE }}>{label}</div>
      <div style={{ ...STAT_VALUE_STYLE }}>{value}</div>
      {trend && <div style={{ ...STAT_TREND_STYLE, color: trendColor(trend) }}>{trend}</div>}
    </div>
  )
}

/** ② props 类型 */
export interface StatBlockProps {
  label?: string
  value?: string
  trend?: string
}

/** ③ 导出模板 */
// 已废弃（B5，B1-2 全量迁移后）：导出统一走下方 buildExport（React/HTML 引擎消费）；本字符串模板函数不再被注册表引用，待二期删除。
export const exportStatBlockTemplate = (props: Record<string, unknown>): string => {
  const label = escapeHtml(typeof props.label === 'string' ? props.label : '指标')
  const value = escapeHtml(typeof props.value === 'string' ? props.value : '0')
  const trend = escapeHtml(typeof props.trend === 'string' ? props.trend : '')
  return `        <div className="rounded-lg border bg-card p-4 shadow-sm">
          <div className="text-sm text-muted-foreground">${label}</div>
          <div className="mt-1 text-2xl font-bold">${value}</div>
${trend ? `          <div className="mt-1 text-xs">${trend}</div>` : ''}
        </div>`
}

/** ④ 属性面板配置 */
export const statBlockSchema = [
  { key: 'label', label: '标签', control: 'text' as const },
  { key: 'value', label: '数值', control: 'text' as const },
  { key: 'trend', label: '趋势', control: 'text' as const },
]

/** B1：导出语义描述（label/value/trend 三段，内部常量样式与引擎 case 一致） */
export const buildStatBlockExport = (node: DesignNode): ExportElement => {
  const props = node.props ?? {}
  // T13 #26：三块内容与画布共用 STAT_* 常量（label 14 / value 24·700·mt4 / trend 12·mt4）
  const children: ExportElement[] = [
    {
      tag: 'div',
      attrs: {},
      style: { ...STAT_LABEL_STYLE },
      text: typeof props.label === 'string' ? props.label : '',
    },
    {
      tag: 'div',
      attrs: {},
      style: { ...STAT_VALUE_STYLE },
      text: typeof props.value === 'string' ? props.value : '',
    },
  ]
  if (typeof props.trend === 'string' && props.trend) {
    children.push({
      tag: 'div',
      attrs: {},
      style: { ...STAT_TREND_STYLE, color: trendColor(props.trend) },
      text: props.trend,
    })
  }
  // T12-D：容器观感与画布共用 STAT_CONTAINER_STYLE（此前导出容器整体透明无边框）
  return { tag: 'div', attrs: {}, style: { ...STAT_CONTAINER_STYLE, ...styleToCss(node.style) }, children }
}
