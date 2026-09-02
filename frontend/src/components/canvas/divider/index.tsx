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
