/**
 * DesignNode 类型（唯一来源：shared/design-schema.json，v2.2 §3.1）。
 * 手写维护；后端用 jsonschema 运行时校验（backend/app/design/validator.py）。
 * 修改 Schema 时必须同步此文件，并由后端测试覆盖关键字段。
 * ⚠️ 受契约测试保护（B0：backend/tests/test_contract.py + registry.test.tsx）：
 * 组件集合与 variant/size/type_ 等枚举不得单独修改——schema / component-library /
 * 属性面板 / 渲染层四方必须一致，改动先过契约测试。
 */
export type NodeType = 'frame' | 'text' | 'rect' | 'component' | 'group'

export type ComponentType =
  | 'button'
  | 'card'
  | 'input'
  | 'select'
  | 'table'
  | 'chart'
  | 'stat-block'
  | 'navbar'
  | 'sidebar'
  | 'avatar'
  | 'tag'
  | 'divider'
  | 'title-text'
  | 'hero'
  | 'image'
  | 'icon'
  | 'switch'
  | 'tabs'

export type LayoutMode = 'row' | 'column' | 'grid' | 'free'

/** 组件 props：schema 中声明的公共字段（组件专属字段见各组件 types.ts） */
export interface ComponentProps {
  text?: string
  label?: string
  placeholder?: string
  disabled?: boolean
  checked?: boolean
  variant?: string
  size?: string
  options?: string[]
  columns?: Array<Record<string, unknown>>
  rows?: Array<Record<string, unknown>>
  items?: Array<Record<string, unknown>>
  links?: Array<Record<string, unknown>>
  active?: string | number
  name?: string
  value?: string | number
  trend?: string
  title?: string
  subtitle?: string
  cta?: Record<string, unknown>
  backgroundImage?: string
  level?: number
  color?: string
  content?: string
  action?: Record<string, unknown>
  type_?: string
  // chart 专属
  chartType?: 'line' | 'bar' | 'pie'
  data?: Array<Record<string, unknown>>
  xKey?: string
  yKey?: string
  // image 专属
  src?: string
  alt?: string
  width?: number | string
  height?: number | string
  fit?: 'cover' | 'contain' | 'fill'
  [key: string]: unknown
}

export interface NodeStyle {
  color?: string
  fontSize?: number
  fontWeight?: number
  spacing?: number
  padding?: number
  layout?: LayoutMode
  gap?: number
  width?: number | string
  height?: number | string
  radius?: number
  background?: string
  align?: 'left' | 'center' | 'right'
  justify?: 'flex-start' | 'center' | 'flex-end' | 'space-between'
  alignItems?: 'flex-start' | 'center' | 'flex-end' | 'stretch'
  flexDirection?: 'row' | 'column'
  [key: string]: unknown
}

export interface DesignNode {
  id: string
  type: NodeType
  componentType?: ComponentType
  props?: ComponentProps
  style?: NodeStyle
  x?: number
  y?: number
  /** 图层管理：隐藏节点（画布不渲染，数据保留） */
  hidden?: boolean
  children?: DesignNode[]
}

export const COMPONENT_TYPES: ComponentType[] = [
  'button', 'card', 'input', 'select', 'table', 'chart', 'stat-block',
  'navbar', 'sidebar', 'avatar', 'tag', 'divider', 'title-text', 'hero', 'image', 'icon', 'switch', 'tabs',
]
