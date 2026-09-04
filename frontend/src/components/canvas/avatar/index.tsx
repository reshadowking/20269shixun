import type { ExportElement } from '@/components/canvas/types'
import { escapeHtml } from '@/design/escape'
import { styleToCss } from '@/design/styleToCss'
import type { DesignNode } from '@/design/types'

/** ① 画布渲染：头像（样式参考 shadcn/ui Avatar；无 src 时显示姓名首字） */
export function CanvasAvatar({ props, style }: { props: Record<string, unknown>; style?: React.CSSProperties }) {
  const name = typeof props.name === 'string' ? props.name : '用户'
  const src = typeof props.src === 'string' ? props.src : ''
  const initial = escapeHtml(name.slice(0, 1))
  return (
    <span className="relative flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary text-sm font-semibold text-primary-foreground" style={style as object}>
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
  return {
    tag: 'div',
    attrs: {},
    style: {
      ...styleToCss(node.style),
      borderRadius: '50%',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    },
    text: name.slice(0, 1),
  }
}
