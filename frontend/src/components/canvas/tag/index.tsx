import type { ExportElement } from '@/components/canvas/types'
import { TAG_BASE_STYLE, TAG_DEFAULT_COLOR_STYLE } from '@/components/canvas/styleTokens'
import { escapeHtml } from '@/design/escape'
import { resolveColor, styleToCss } from '@/design/styleToCss'
import type { DesignNode } from '@/design/types'

/** ① 画布渲染：标签（样式参考 shadcn/ui Badge）。
 * T12-D 修复（缺口 §4.11）：彩色分支此前把令牌名当 CSS 值（background: 'danger'）→ CSSOM
 * 丢弃 → 白字无底色 = 标签隐形。现经 resolveColor 解析为令牌色（resolveColor(color) ?? color，
 * hex 原样）；文字色语义一并令牌化为白（#FFFFFF，既有例外口径）。默认分支 = secondary 底 + 白字。 */
export function CanvasTag({ props, style }: { props: Record<string, unknown>; style?: React.CSSProperties }) {
  const text = typeof props.text === 'string' ? props.text : '标签'
  const color = typeof props.color === 'string' ? props.color : 'default'
  const colored = color === 'danger' || color === 'primary' || color === 'success'
  return (
    <span
      data-testid="canvas-tag"
      style={{
        ...TAG_BASE_STYLE,
        ...(colored ? { background: resolveColor(color) ?? color, color: '#FFFFFF' } : TAG_DEFAULT_COLOR_STYLE),
        ...(style as object),
      }}
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
// 已废弃（B5，B1-2 全量迁移后）：导出统一走下方 buildExport（React/HTML 引擎消费）；本字符串模板函数不再被注册表引用，待二期删除。
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

/** B1：导出语义描述（引擎 case 语义：仅文本与样式，无 Tailwind 依赖）。
 * T12-D：基础观感（圆角/内边距/字号/字重）与底色补齐并与画布共用 TAG_* 常量；
 * 彩色分支同样经 resolveColor 解析（未解析的令牌名字面量绝不出现在产物中，parity 有反断言）。 */
export const buildTagExport = (node: DesignNode): ExportElement => {
  const props = node.props ?? {}
  const color = typeof props.color === 'string' ? props.color : 'default'
  const colored = color === 'danger' || color === 'primary' || color === 'success'
  return {
    tag: 'span',
    attrs: {},
    style: {
      ...TAG_BASE_STYLE,
      ...(colored ? { background: resolveColor(color) ?? color, color: '#FFFFFF' } : TAG_DEFAULT_COLOR_STYLE),
      ...styleToCss(node.style),
    },
    text: typeof props.text === 'string' ? props.text : '',
  }
}
