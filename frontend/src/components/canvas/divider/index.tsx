import type { ExportElement } from '@/components/canvas/types'
import { styleToCss } from '@/design/styleToCss'
import type { DesignNode } from '@/design/types'

/** ① 画布渲染：分割线（样式参考 shadcn/ui Separator） */
export function CanvasDivider({ style }: { props: Record<string, unknown>; style?: React.CSSProperties }) {
  return <div className="h-px w-full bg-border" style={style as object} />
}

/** ② props 类型 */
export interface DividerProps {
  // 无参数
}

/** ③ 导出模板 */
export const exportDividerTemplate = (): string =>
  `        <div className="h-px w-full bg-border" />`

/** ④ 属性面板配置 */
export const dividerSchema: { key: string; label: string; control: 'text' }[] = []

/** B1：导出语义描述（void 元素 hr，引擎负责自闭合） */
export const buildDividerExport = (node: DesignNode): ExportElement => ({
  tag: 'hr',
  attrs: {},
  style: styleToCss(node.style),
})
