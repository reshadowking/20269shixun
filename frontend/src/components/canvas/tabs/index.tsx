import type { ExportElement } from '@/components/canvas/types'
import { resolveColor, styleToCss } from '@/design/styleToCss'
import { BUTTON_BASE_STYLE } from '@/components/canvas/styleTokens'
import type { DesignNode } from '@/design/types'

/**
 * T9 方案②：tabs（标签页）——选中态写在 props.active（与 switch 同口径，不引组件内部
 * 语义 state；CanvasSelect 的内部 useState 教训：选中值不进树 → 撤销/协作/保存/导出全丢）。
 *
 * ⚠️ active 取值口径（任务卡 §4.3）：【number index 为唯一写入口径】——点击标签写它的
 * 序号，与"第几个"语义一致；【string 标签文本为容错读取形态】（sidebar 的 active 用的
 * 就是标签文本，两种形态都接受）。都不命中 → 无选中项。
 *
 * ⚠️ 版面锁定（§4.4）：锁定态下 updateNode 的数据层守卫拒绝任何 props 变更——点击标签
 * 不生效属预期，且会触发 subscribeBlocked 的可见提示，不静默。
 * hover 高亮是瞬时视觉态（非语义状态），不入树、不导出（导出静态按 active 渲染）。
 */

/** 画布/导出共用：标签项基础观感（复用 BUTTON_BASE_STYLE 令牌，不新造色值） */
const TAB_ITEM_BASE: React.CSSProperties = {
  ...BUTTON_BASE_STYLE,
  padding: '8px 4px',
  background: 'transparent',
  border: 'none',
  cursor: 'pointer',
}

/** active 命中判定：number 按序号、string 按标签文本（口径见文件头注释） */
function isActiveItem(itemLabel: string, index: number, active: unknown): boolean {
  if (typeof active === 'number') return index === active
  if (typeof active === 'string') return itemLabel === active
  return false
}

/** items 容错解析：主形态 [{label}]；元素缺 label → 丢弃、裸字符串 → 原文、空串 → 过滤；
 * 整体字符串（属性面板 textarea 手输 JSON）尝试 parse；失败 → 空数组（渲染占位） */
export function parseTabsItems(value: unknown): string[] {
  if (typeof value === 'string') {
    try {
      return parseTabsItems(JSON.parse(value))
    } catch {
      return []
    }
  }
  if (!Array.isArray(value)) return []
  return value
    .map((it) => {
      if (typeof it === 'string') return it
      if (it && typeof it === 'object' && 'label' in it) return String((it as Record<string, unknown>).label ?? '')
      return ''
    })
    .filter((label) => label.trim().length > 0)
}

/** ① 画布渲染：一排标签按钮；active 项主色文字 + 底部 2px 主色下划线，非 active → text-light */
export function CanvasTabs({ props, style, onPropsChange }: { props: Record<string, unknown>; style?: React.CSSProperties; onPropsChange?: (key: string, value: unknown) => void }) {
  const items = parseTabsItems(props.items)
  return (
    <div className="flex items-center gap-6" style={style as object} data-testid="canvas-tabs">
      {items.length === 0 && <span style={{ color: resolveColor('text-light'), fontSize: 14 }}>标签页</span>}
      {items.map((label, i) => {
        const isActive = isActiveItem(label, i, props.active)
        return (
          <button
            key={`${label}-${i}`}
            type="button"
            className="transition hover:opacity-80"
            // stopPropagation：切换是组件内交互，不冒泡成画布拖拽/选中（与 select 同口径）
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation()
              if (!isActive) onPropsChange?.('active', i)
            }}
            style={{
              ...TAB_ITEM_BASE,
              borderBottom: `2px solid ${isActive ? resolveColor('primary') : 'transparent'}`,
              color: isActive ? resolveColor('primary') : resolveColor('text-light'),
            }}
          >
            {label}
          </button>
        )
      })}
    </div>
  )
}

/** ② props 类型（复用既有 items/active 字段——零新增 props 字段，任务卡 §4.3 设计要点） */
export interface TabsProps {
  items?: Array<Record<string, unknown>>
  active?: string | number
}

/** ③ 导出语义描述：静态按 active 渲染选中形态（属性面板改了 active 产物跟着变）；
 * 「点击切换」交互不导出（与 button 的 hover 同口径）；hover 同为交互态不导出。 */
export const buildTabsExport = (node: DesignNode): ExportElement => {
  const props = node.props ?? {}
  const items = parseTabsItems(props.items)
  return {
    tag: 'div',
    attrs: { role: 'tablist' },
    style: { display: 'flex', alignItems: 'center', gap: 24, ...styleToCss(node.style) },
    children: items.length === 0
      ? [{ tag: 'span', attrs: {}, style: { color: resolveColor('text-light'), fontSize: 14 }, text: '标签页' }]
      : items.map((label, i) => {
          const isActive = isActiveItem(label, i, props.active)
          return {
            tag: 'button',
            attrs: { type: 'button' },
            style: {
              ...TAB_ITEM_BASE,
              borderBottom: `2px solid ${isActive ? resolveColor('primary') : 'transparent'}`,
              color: isActive ? resolveColor('primary') : resolveColor('text-light'),
            },
            text: label,
          }
        }),
  }
}

/** ④ 属性面板配置：与画布点击共用 props.active（不得各存一份） */
export const tabsSchema = [
  { key: 'items', label: '标签项（JSON 数组）', control: 'json' as const },
  { key: 'active', label: '选中项（序号）', control: 'number' as const, min: 0 },
]
