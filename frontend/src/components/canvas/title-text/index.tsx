import { escapeHtml } from '@/design/escape'

/** ① 画布渲染：标题文本（h1-h6） */
export function CanvasTitleText({ props, style }: { props: Record<string, unknown>; style?: React.CSSProperties }) {
  const text = typeof props.text === 'string' ? props.text : '标题'
  const level = Math.min(6, Math.max(1, typeof props.level === 'number' ? props.level : 2))
  const sizes: Record<number, number> = { 1: 28, 2: 24, 3: 20, 4: 18, 5: 16, 6: 14 }
  return (
    <div className="font-semibold leading-tight" style={{ fontSize: sizes[level], ...(style as object) }}>
      {text}
    </div>
  )
}

/** ② props 类型 */
export interface TitleTextProps {
  text?: string
  level?: 1 | 2 | 3 | 4 | 5 | 6
}

/** ③ 导出模板 */
export const exportTitleTextTemplate = (props: Record<string, unknown>): string => {
  const text = escapeHtml(typeof props.text === 'string' ? props.text : '标题')
  const level = Math.min(6, Math.max(1, typeof props.level === 'number' ? props.level : 2))
  const sizes: Record<number, number> = { 1: 28, 2: 24, 3: 20, 4: 18, 5: 16, 6: 14 }
  return `        <div className="font-semibold leading-tight" style={{ fontSize: ${sizes[level]} }}>
          ${text}
        </div>`
}

/** ④ 属性面板配置 */
export const titleTextSchema = [
  { key: 'text', label: '文本', control: 'textarea' as const },
  { key: 'level', label: '级别', control: 'select' as const, options: ['1', '2', '3', '4', '5', '6'] },
]
