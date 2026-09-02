import { escapeHtml } from '@/design/escape'

/** ① 画布渲染：Hero 大图区（样式参考 shadcn/ui 大图样式） */
export function CanvasHero({ props, style: _style }: { props: Record<string, unknown>; style?: React.CSSProperties }) {
  const title = typeof props.title === 'string' ? props.title : '主标题'
  const subtitle = typeof props.subtitle === 'string' ? props.subtitle : ''
  const ctaText = typeof (props.cta as { text?: unknown } | undefined)?.text === 'string'
    ? (props.cta as { text?: string }).text
    : ''
  const bg = typeof props.backgroundImage === 'string' ? props.backgroundImage : ''
  return (
    <div
      className="flex w-full flex-col items-center justify-center gap-4 bg-muted px-12 py-20 text-center"
      style={bg ? { backgroundImage: `url(${bg})`, backgroundSize: 'cover', backgroundPosition: 'center' } : undefined}
      data-testid="canvas-hero"
    >
      <div className="text-4xl font-bold">{title}</div>
      {subtitle && <div className="text-lg text-muted-foreground">{subtitle}</div>}
      {ctaText && (
        <div className="mt-2 inline-flex items-center justify-center rounded-md bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground shadow-sm">
          {escapeHtml(ctaText)}
        </div>
      )}
    </div>
  )
}

/** ② props 类型 */
export interface HeroProps {
  title?: string
  subtitle?: string
  cta?: { text?: string }
  backgroundImage?: string
}

/** ③ 导出模板 */
export const exportHeroTemplate = (props: Record<string, unknown>): string => {
  const title = escapeHtml(typeof props.title === 'string' ? props.title : '主标题')
  const subtitle = escapeHtml(typeof props.subtitle === 'string' ? props.subtitle : '')
  const ctaText = typeof (props.cta as { text?: unknown } | undefined)?.text === 'string'
    ? (props.cta as { text?: string }).text
    : ''
  const cta = escapeHtml(ctaText ?? '')
  const bg = typeof props.backgroundImage === 'string' ? props.backgroundImage : ''
  return `        <section className="flex w-full flex-col items-center justify-center gap-4 bg-muted px-12 py-20 text-center"${bg ? ` style={{ backgroundImage: 'url(${escapeHtml(bg)})', backgroundSize: 'cover', backgroundPosition: 'center' }}` : ''}>
          <h1 className="text-4xl font-bold">${title}</h1>
${subtitle ? `          <p className="text-lg text-muted-foreground">${subtitle}</p>` : ''}
${cta ? `          <button className="mt-2 inline-flex items-center justify-center rounded-md bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground shadow-sm">${cta}</button>` : ''}
        </section>`
}

/** ④ 属性面板配置 */
export const heroSchema = [
  { key: 'title', label: '主标题', control: 'text' as const },
  { key: 'subtitle', label: '副标题', control: 'text' as const },
  { key: 'cta', label: '按钮文本', control: 'text' as const },
  { key: 'backgroundImage', label: '背景图 URL', control: 'text' as const },
]
