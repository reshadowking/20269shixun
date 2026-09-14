import type { ExportElement } from '@/components/canvas/types'
import { DIVIDER_STYLE } from '@/components/canvas/styleTokens'
import { styleToCss } from '@/design/styleToCss'
import type { DesignNode } from '@/design/types'

/** ① 画布渲染：分割线（样式参考 shadcn/ui Separator；T12-D 默认观感内联、画布/导出共用 DIVIDER_STYLE） */
export function CanvasDivider({ style }: { props: Record<string, unknown>; style?: React.CSSProperties }) {
  return <div style={{ ...DIVIDER_STYLE, ...(style as object) }} />
}

/** ② props 类型 */
export interface DividerProps {
  // 无参数
}

/** ③ 导出模板 */
// 已废弃（B5，B1-2 全量迁移后）：导出统一走下方 buildExport（React/HTML 引擎消费）；本字符串模板函数不再被注册表引用，待二期删除。
export const exportDividerTemplate = (): string =>
  `        <div className="h-px w-full bg-border" />`

/** ④ 属性面板配置 */
export const dividerSchema: { key: string; label: string; control: 'text' }[] = []

/** B1：导出语义描述（void 元素 hr，引擎负责自闭合）。
 * T12-D：高度 1px / border 令牌色与画布同源；<hr> 浏览器默认边框与 margin 已清零
 * （DIVIDER_STYLE 的 border:none + margin:0），画布与导出的间距一致。 */
export const buildDividerExport = (node: DesignNode): ExportElement => ({
  tag: 'hr',
  attrs: {},
  style: { ...DIVIDER_STYLE, ...styleToCss(node.style) },
})
