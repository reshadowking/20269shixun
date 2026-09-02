import type { ComponentType, CSSProperties } from 'react'


/** 属性面板控件类型（v2.2 §5.2 schema.ts 第四件） */
export interface PropField {
  key: string
  label: string
  control: 'text' | 'textarea' | 'number' | 'select' | 'switch' | 'color'
  options?: string[]
  min?: number
  max?: number
}

/** 画布组件渲染的统一入参（style 为已转换的 CSS 样式，radius→borderRadius 等） */
export interface CanvasComponentProps {
  props: Record<string, unknown>
  style?: CSSProperties
  /** 缺陷 4/14：组件内部交互（图片 fit 切换等）写回 props，经 Yjs 事务同步 */
  onPropsChange?: (key: string, value: unknown) => void
}

/** 组件定义：四件套（渲染/类型/导出模板/属性配置）在注册表汇聚一行 */
export interface ComponentDefinition {
  type: string
  label: string
  /** 画布渲染（样式参考 shadcn/ui className 自实现，不 import 进画布） */
  Canvas: ComponentType<CanvasComponentProps>
  /** 导出模板：props → React+TS+Tailwind 代码字符串（纯模板拼装，不允许 LLM 生成） */
  exportTemplate: (props: Record<string, unknown>) => string
  /** 属性面板配置 */
  schema: PropField[]
}
