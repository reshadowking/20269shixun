import type { ExportElement } from '@/components/canvas/types'
import { AVATAR_DEFAULT_STYLE } from '@/components/canvas/styleTokens'
import { escapeHtml } from '@/design/escape'
import { styleToCss } from '@/design/styleToCss'
import type { DesignNode } from '@/design/types'

/** ① 画布渲染：头像（样式参考 shadcn/ui Avatar；无 src 时显示姓名首字） */
export function CanvasAvatar({ props, style }: { props: Record<string, unknown>; style?: React.CSSProperties }) {
  const name = typeof props.name === 'string' ? props.name : '用户'
  const src = typeof props.src === 'string' ? props.src : ''
  const initial = escapeHtml(name.slice(0, 1))
  return (
    // 默认观感内联（T12-D，画布/导出共用 AVATAR_DEFAULT_STYLE）；overflow/relative 属布局保留
    <span className="relative shrink-0 overflow-hidden" style={{ ...AVATAR_DEFAULT_STYLE, ...(style as object) }}>
      {src ? <img src={src} alt={escapeHtml(name)} className="aspect-square h-full w-full object-cover" /> : initial}
    </span>
  )
}

/** ② props 类型 */
export interface AvatarProps {
  name?: string
  src?: string
}

/** ③ 导出模板 */
// 已废弃（B5，B1-2 全量迁移后）：导出统一走下方 buildExport（React/HTML 引擎消费）；本字符串模板函数不再被注册表引用，待二期删除。
export const exportAvatarTemplate = (props: Record<string, unknown>): string => {
  const name = escapeHtml(typeof props.name === 'string' ? props.name : '用户')
  const src = typeof props.src === 'string' ? props.src : ''
  return src
    ? `        <span className="relative flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary text-sm font-semibold text-primary-foreground">
          <img src="${escapeHtml(src)}" alt="${name}" className="aspect-square h-full w-full object-cover" />
        </span>`
    : `        <span className="relative flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary text-sm font-semibold text-primary-foreground">
          ${escapeHtml(name.slice(0, 1))}
        </span>`
}

/** ④ 属性面板配置 */
export const avatarSchema = [
  { key: 'name', label: '姓名', control: 'text' as const },
  { key: 'src', label: '图片 URL', control: 'text' as const },
]

/** B1：导出语义描述（圆形容器 + 姓名首字；与引擎 case 一致） */
export const buildAvatarExport = (node: DesignNode): ExportElement => {
  const props = node.props ?? {}
  const name = typeof props.name === 'string' ? props.name : ''
  // T12-D：尺寸 40×40 / primary 底 / 白字 / 字号补齐并与画布共用 AVATAR_DEFAULT_STYLE；
  // 圆形与居中并入该常量（值不变，一处定义）；展开顺序修正为「默认在前、node.style 最后」。
  return {
    tag: 'div',
    attrs: {},
    style: { ...AVATAR_DEFAULT_STYLE, ...styleToCss(node.style) },
    text: name.slice(0, 1),
  }
}
