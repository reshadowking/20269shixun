import type { ComponentType, CSSProperties } from 'react'

import type { DesignNode } from '@/design/types'

/** 属性面板控件类型（v2.2 §5.2 schema.ts 第四件；upload=D2 本地图片上传） */
export interface PropField {
  key: string
  label: string
  control: 'text' | 'textarea' | 'number' | 'select' | 'switch' | 'color' | 'upload'
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

/**
 * B1 导出语义节点（试点）：React/HTML 双引擎共享的中间表示。
 * - attrs 保存原始值（协议白名单在 buildExport 内完成）；引号/HTML 转义由引擎统一负责（P0-1 防线不变）
 * - style 为 styleToCss 结果（React 引擎 JSON 序列化、HTML 引擎 kebab+px）
 * - 组件根元素上的 data-component 由 React 引擎统一添加
 */
export interface ExportElement {
  tag: string
  attrs: Record<string, string>
  style: CSSProperties
  text?: string
  children?: ExportElement[]
}

/** 组件定义：四件套（渲染/类型/导出模板/属性配置）在注册表汇聚一行 */
export interface ComponentDefinition {
  type: string
  label: string
  /** 画布渲染（样式参考 shadcn/ui className 自实现，不 import 进画布） */
  Canvas: ComponentType<CanvasComponentProps>
  /** 导出模板：props → React+TS+Tailwind 代码字符串（纯模板拼装，不允许 LLM 生成） */
  exportTemplate: (props: Record<string, unknown>) => string
  /** B1 试点：导出语义描述（buildExport 存在时 React/HTML 引擎经它序列化，替代手写 switch case） */
  buildExport?: (node: DesignNode) => ExportElement
  /** 属性面板配置 */
  schema: PropField[]
}
