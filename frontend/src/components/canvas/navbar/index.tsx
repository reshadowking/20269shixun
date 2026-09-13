import type { ExportElement } from '@/components/canvas/types'
import { escapeHtml, safeHref } from '@/design/escape'
import { styleToCss } from '@/design/styleToCss'
import { NAV_LINK_COLOR } from '@/components/canvas/styleTokens'
import type { DesignNode } from '@/design/types'

interface NavLink { label?: string; href?: string }

/** ① 画布渲染：顶部导航（样式参考 shadcn/ui 导航样式） */
export function CanvasNavbar({ props, style }: { props: Record<string, unknown>; style?: React.CSSProperties }) {
  const title = typeof props.title === 'string' ? props.title : '品牌'
  const links = Array.isArray(props.links) ? (props.links as NavLink[]) : []
  return (
    <div className="flex h-14 w-full items-center justify-between border-b bg-background px-6" style={style as object}>
      <div className="text-lg font-semibold">{title}</div>
      <div className="flex items-center gap-6">
        {links.map((link, i) => (
          <a key={i} href={safeHref(link.href)} className="text-sm hover:text-foreground" style={{ color: NAV_LINK_COLOR }}>
            {escapeHtml(link.label ?? '链接')}
          </a>
        ))}
      </div>
    </div>
  )
}

/** ② props 类型 */
export interface NavbarProps {
  title?: string
  links?: NavLink[]
}

/** ③ 导出模板 */
// 已废弃（B5，B1-2 全量迁移后）：导出统一走下方 buildExport（React/HTML 引擎消费）；本字符串模板函数不再被注册表引用，待二期删除。
export const exportNavbarTemplate = (props: Record<string, unknown>): string => {
  const title = escapeHtml(typeof props.title === 'string' ? props.title : '品牌')
  const links = Array.isArray(props.links) ? (props.links as NavLink[]) : []
  return `        <nav className="flex h-14 w-full items-center justify-between border-b bg-background px-6">
          <div className="text-lg font-semibold">${title}</div>
          <div className="flex items-center gap-6">
${links.map((link) => `            <a href="${escapeHtml(safeHref(link.href))}" className="text-sm text-muted-foreground hover:text-foreground">${escapeHtml(link.label ?? '链接')}</a>`).join('\n')}
          </div>
        </nav>`
}

/** ④ 属性面板配置 */
export const navbarSchema = [
  { key: 'title', label: '品牌名', control: 'text' as const },
  { key: 'links', label: '链接（JSON 数组）', control: 'textarea' as const },
]

/** B1：导出语义描述——href 在此过 safeHref 白名单；链接间距双通道统一 marginLeft 12 */
export const buildNavbarExport = (node: DesignNode): ExportElement => {
  const props = node.props ?? {}
  const links = Array.isArray(props.links) ? (props.links as NavLink[]) : []
  return {
    tag: 'nav',
    attrs: {},
    style: styleToCss(node.style),
    children: [
      { tag: 'strong', attrs: {}, style: {}, text: typeof props.title === 'string' ? props.title : '' },
      // 链接色 = NAV_LINK_COLOR（text-light，与画布同源）。hover:text-foreground 是交互态，
      // 静态导出产物不实现 hover——有意为之，非遗漏（任务卡 §4.1 口径 8）。
      ...links.map((l) => ({
        tag: 'a' as const,
        attrs: { href: safeHref(l.href) },
        style: { marginLeft: 12, color: NAV_LINK_COLOR },
        text: typeof l.label === 'string' ? l.label : '',
      })),
    ],
  }
}
