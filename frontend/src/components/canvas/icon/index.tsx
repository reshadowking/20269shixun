import iconLibrary from '../../../../../shared/icon-library.json'

import type { ExportElement } from '@/components/canvas/types'
import { resolveColor, styleToCss } from '@/design/styleToCss'
import type { DesignNode } from '@/design/types'

/**
 * T9 方案①：icon（图标）——用 lucide 的【图标数据】而不是 lucide 这个库。
 * 导出产物是零依赖 + 内联样式的：不能用 emoji（跨平台字形不一）、不能引 lucide-react
 * 运行时（导出用不了），所以把 svg path 抽成 shared/icon-library.json 共享数据，
 * 画布与导出各自内联 <svg viewBox="0 0 24 24"><path d/></svg>（stroke: currentColor 驱动，
 * 换 color 令牌只改一处）。
 */

/** 图标库单一来源（与后端 generate.py 共读同一 JSON；契约测试两端对称护栏） */
export interface IconDef {
  name: string
  label: string
  path: string
}
export const ICON_LIBRARY = iconLibrary as unknown as { _comment: string; icons: IconDef[] }

/** 未知 name 兜底占位：name 是普通 string（Schema 不拒，模型编造不会整树回退），
 * 查不到时渲染它并记日志——这里是唯一防线（help-circle 也是库内成员，渲染路径与正常图标一致） */
export const FALLBACK_ICON_NAME = 'help-circle'

/** 缺省图标：组件库 default（star），与提示词口径一致；name 缺失不算"编造"，不告警 */
export const DEFAULT_ICON_NAME = ICON_LIBRARY.icons[0].name

/** 尺寸档位 → px（复用全局 size enum sm/default/lg，任务卡 §2.1：size 不是数字） */
export const ICON_SIZE_PX: Record<string, number> = { sm: 16, default: 20, lg: 24 }

/** 图标缺省色（令牌名；tag 的 color 同款语义） */
export const DEFAULT_ICON_COLOR = 'text-primary'

/** 查表：非空字符串进白名单查；未命中 → 兜底占位 + console.warn（后端 repair_design 同步记 gen_logger） */
export function resolveIcon(name: unknown): IconDef {
  if (typeof name === 'string' && name) {
    const hit = ICON_LIBRARY.icons.find((i) => i.name === name)
    if (hit) return hit
    console.warn(`[canvas-icon] 未知图标名 "${name}"，兜底渲染 ${FALLBACK_ICON_NAME}（白名单见 shared/icon-library.json）`)
    const fallback = ICON_LIBRARY.icons.find((i) => i.name === FALLBACK_ICON_NAME)
    if (fallback) return fallback
  }
  return ICON_LIBRARY.icons.find((i) => i.name === DEFAULT_ICON_NAME) ?? ICON_LIBRARY.icons[0]
}

/**
 * 名字是否在库内（2026-09-16）。
 *
 * 空值/非字符串 = "没提供"，按缺省图标处理、**不算未知**；非空但不在白名单 = 未知 →
 * 渲染兜底图标的同时，在节点上打 `data-icon-fallback="<原名字>"`。
 *
 * 为什么要有这个可见标记：以前未知名字只在 console 里 warn，导出产物里看到的是一个
 * 正常的问号图标，**没人能发现模型编造过名字**（排查时只能靠翻日志）。
 */
export function isKnownIconName(name: unknown): boolean {
  return typeof name === 'string' && ICON_LIBRARY.icons.some((i) => i.name === name)
}

/** 未知名（非空且在库外）→ 返回原名字用于打标记；否则 undefined */
function unknownIconName(name: unknown): string | undefined {
  if (typeof name !== 'string' || name === '') return undefined
  return isKnownIconName(name) ? undefined : name
}

/** ① 画布渲染：静态图标，无交互态（无 onPropsChange——状态断言见 icon.test.tsx 说明）。
 * 画布选中态由选中框表达、不导出（与 button 的 hover 同口径）。 */
export function CanvasIcon({ props, style }: { props: Record<string, unknown>; style?: React.CSSProperties }) {
  const def = resolveIcon(props.name)
  const size = typeof props.size === 'string' ? props.size : 'default'
  const px = ICON_SIZE_PX[size] ?? ICON_SIZE_PX.default
  const color = resolveColor(typeof props.color === 'string' && props.color ? props.color : DEFAULT_ICON_COLOR)
  const unknown = unknownIconName(props.name)
  return (
    // display 内联（jsdom 可测、导出同步）；画布选中态由选中框表达、不导出
    <span
      style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color, ...(style as object) }}
      data-testid="canvas-icon"
      data-icon-fallback={unknown}
    >
      <svg
        viewBox="0 0 24 24"
        width={px}
        height={px}
        style={{ stroke: 'currentColor', fill: 'none', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }}
      >
        <path d={def.path} />
      </svg>
    </span>
  )
}

/** ② props 类型（复用既有字段，零新增 props 字段——任务卡 §4.1） */
export interface IconProps {
  name?: string
  color?: string
  size?: 'sm' | 'default' | 'lg'
}

/** ③ 导出语义描述（React/HTML 引擎共用）。
 * ⚠️ SVG 属性分通道（任务卡 §4.1/陷阱 8）：attrs 原样进两通道，只放拼写一致且 React 认的
 * viewBox 与 d；stroke/strokeWidth/strokeLinecap/strokeLinejoin/fill 一律放 style——style 是
 * 通道感知的（React 原样序列化 → strokeWidth: 2；HTML 通道 kebab 化 + 数值加 px → stroke-width: 2px，
 * SVG 里两者均合法，parity 测试断等价不断字面相等）。 */
export const buildIconExport = (node: DesignNode): ExportElement => {
  const props = node.props ?? {}
  const def = resolveIcon(props.name)
  const size = typeof props.size === 'string' ? props.size : 'default'
  const px = ICON_SIZE_PX[size] ?? ICON_SIZE_PX.default
  const color = resolveColor(typeof props.color === 'string' && props.color ? props.color : DEFAULT_ICON_COLOR)
  const unknown = unknownIconName(props.name)
  return {
    tag: 'span',
    // 未知名在**两个通道**都要留下痕迹（同一份语义数据驱动，parity 断言等价）
    attrs: unknown ? { 'data-icon-fallback': unknown } : {},
    style: { display: 'inline-flex', color, ...styleToCss(node.style) },
    children: [
      {
        tag: 'svg',
        attrs: { viewBox: '0 0 24 24' },
        style: { width: px, height: px, stroke: 'currentColor', fill: 'none', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' },
        children: [{ tag: 'path', attrs: { d: def.path }, style: {} }],
      },
    ],
  }
}

/** ④ 属性面板配置：图标下拉选项从 ICON_LIBRARY 现算（getter 每次取值即时求值，杜绝对手抄清单，陷阱 11） */
export const iconSchema = [
  { key: 'name', label: '图标', control: 'select' as const, get options() { return ICON_LIBRARY.icons.map((i) => i.name) } },
  { key: 'color', label: '颜色', control: 'color' as const },
  { key: 'size', label: '尺寸', control: 'select' as const, options: ['sm', 'default', 'lg'] },
]
