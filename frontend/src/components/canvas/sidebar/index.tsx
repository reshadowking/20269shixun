import { escapeHtml } from '@/design/escape'

interface SideItem { label?: string }

/** ① 画布渲染：侧边栏（样式参考 shadcn/ui 侧边栏样式） */
export function CanvasSidebar({ props, style }: { props: Record<string, unknown>; style?: React.CSSProperties }) {
  const items = Array.isArray(props.items) ? (props.items as SideItem[]) : []
  const active = typeof props.active === 'string' ? props.active : ''
  return (
    <div className="flex w-48 flex-col gap-1 bg-foreground/95 p-4 text-foreground" style={style as object}>
      {items.map((item, i) => {
        const isActive = item.label === active
        return (
          <div
            key={i}
            className={`rounded-md px-3 py-2 text-sm ${isActive ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}`}
          >
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
