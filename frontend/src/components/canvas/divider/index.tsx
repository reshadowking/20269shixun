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
// 已废弃（B5，B1-2 全量迁移后）：导出统一走下方 buildExport（React/HTML 引擎消费）；本字符串模板函数不再被注册表引用，待二期删除。
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
