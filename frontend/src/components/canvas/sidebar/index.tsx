import type { ExportElement } from '@/components/canvas/types'
import { escapeHtml } from '@/design/escape'
import { resolveColor, styleToCss } from '@/design/styleToCss'
import type { DesignNode } from '@/design/types'

interface SideItem { label?: string }

/**
 * 侧栏配色（T5-0 #4 修复）：画布与导出共用——根底色 = text-primary 令牌 95% 透明度
 * （对应画布原 bg-foreground/95），active = primary 底 + 白字，非 active = text-light
 * （与画布 muted-foreground #86909c 同源）。此前导出只有 padding，active 态与根底色
 * 整体丢失，导出工程里"侧栏没选中、没底色"。
 */
function withAlpha(hex: string | undefined, alpha: number): string {
  const n = parseInt((hex ?? '#000000').slice(1), 16)
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`
}
const ASIDE_BG = withAlpha(resolveColor('text-primary'), 0.95)
const SIDEBAR_ITEM_ACTIVE: React.CSSProperties = { background: resolveColor('primary'), color: '#FFFFFF' }
const SIDEBAR_ITEM_IDLE: React.CSSProperties = { color: resolveColor('text-light') }

/** ① 画布渲染：侧边栏（样式参考 shadcn/ui 侧边栏样式）。色彩内联（T5-0）：jsdom
 * 不解析 Tailwind 类，内联后画布/导出同源且可测。 */
export function CanvasSidebar({ props, style }: { props: Record<string, unknown>; style?: React.CSSProperties }) {
  const items = Array.isArray(props.items) ? (props.items as SideItem[]) : []
  const active = typeof props.active === 'string' ? props.active : ''
  return (
    <div className="flex w-48 flex-col gap-1 p-4" style={{ backgroundColor: ASIDE_BG, ...(style as object) }}>
      {items.map((item, i) => {
        const isActive = item.label === active
        return (
          <div key={i} className="rounded-md px-3 py-2 text-sm" style={isActive ? SIDEBAR_ITEM_ACTIVE : SIDEBAR_ITEM_IDLE}>
            {escapeHtml(item.label ?? '菜单项')}
          </div>
        )
      })}
    </div>
  )
}

/** ② props 类型 */
export interface SidebarProps {
  items?: SideItem[]
  active?: string
}

/** ③ 导出模板 */
// 已废弃（B5，B1-2 全量迁移后）：导出统一走下方 buildExport（React/HTML 引擎消费）；本字符串模板函数不再被注册表引用，待二期删除。
export const exportSidebarTemplate = (props: Record<string, unknown>): string => {
  const items = Array.isArray(props.items) ? (props.items as SideItem[]) : []
  const active = typeof props.active === 'string' ? props.active : ''
  return `        <aside className="flex w-48 flex-col gap-1 bg-foreground/95 p-4">
${items.map((item) => {
    const isActive = item.label === active
    return isActive
      ? `          <div className="rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground">${escapeHtml(item.label ?? '菜单项')}</div>`
      : `          <div className="rounded-md px-3 py-2 text-sm text-muted-foreground">${escapeHtml(item.label ?? '菜单项')}</div>`
  }).join('\n')}
        </aside>`
}

/** ④ 属性面板配置 */
export const sidebarSchema = [
  { key: 'items', label: '菜单项（JSON 数组）', control: 'textarea' as const },
  { key: 'active', label: '选中项', control: 'text' as const },
]

/** B1：导出语义描述（菜单项渲染 label）。T5-0 #4：active 高亮/非 active 灰/根底色
 * 与画布共用同一常量，node.style 仍可覆盖根样式。 */
export const buildSidebarExport = (node: DesignNode): ExportElement => {
  const props = node.props ?? {}
  const items = Array.isArray(props.items) ? (props.items as SideItem[]) : []
  const active = typeof props.active === 'string' ? props.active : ''
  return {
    tag: 'aside',
    attrs: {},
    style: { backgroundColor: ASIDE_BG, ...styleToCss(node.style) },
    children: items.map((it) => ({
      tag: 'div',
      attrs: {},
      style: {
        padding: '8px 12px',
        ...(it.label === active ? SIDEBAR_ITEM_ACTIVE : SIDEBAR_ITEM_IDLE),
      },
      text: typeof it.label === 'string' ? it.label : '',
    })),
  }
}
