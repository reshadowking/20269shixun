import type { ExportElement } from '@/components/canvas/types'
import { HERO_CTA_STYLE, HERO_DEFAULT_STYLE, HERO_SUBTITLE_STYLE, HERO_TITLE_STYLE } from '@/components/canvas/styleTokens'
import { escapeHtml } from '@/design/escape'
import { styleToCss } from '@/design/styleToCss'
import type { DesignNode } from '@/design/types'

/** ① 画布渲染：Hero 大图区（样式参考 shadcn/ui 大图样式；T12-B 默认观感内联、画布/导出共用 HERO_*） */
export function CanvasHero({ props, style }: { props: Record<string, unknown>; style?: React.CSSProperties }) {
  const title = typeof props.title === 'string' ? props.title : '主标题'
  const subtitle = typeof props.subtitle === 'string' ? props.subtitle : ''
  const ctaText = typeof (props.cta as { text?: unknown } | undefined)?.text === 'string'
    ? (props.cta as { text?: string }).text
    : ''
  const bg = typeof props.backgroundImage === 'string' ? props.backgroundImage : ''
  return (
    <div
      data-testid="canvas-hero"
      style={{
        ...HERO_DEFAULT_STYLE,
        ...(bg ? { backgroundImage: `url(${bg})`, backgroundSize: 'cover', backgroundPosition: 'center' } : {}),
        ...(style as object),
      }}
    >
      <div style={HERO_TITLE_STYLE}>{title}</div>
      {subtitle && <div style={HERO_SUBTITLE_STYLE}>{subtitle}</div>}
      {ctaText && <div style={HERO_CTA_STYLE}>{escapeHtml(ctaText)}</div>}
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
// 已废弃（B5，B1-2 全量迁移后）：导出统一走下方 buildExport（React/HTML 引擎消费）；本字符串模板函数不再被注册表引用，待二期删除。
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

/** B1：导出语义描述（h2/p/button 层次；与引擎 case 一致）。
 * T12-B：容器/标题/副标题/CTA 默认观感与画布共用 HERO_* 常量（CTA 复用按钮配方）——
 * 此前导出约等于一段无样式文字，与画布完全不像。backgroundImage 的 url() 逻辑保持（仅画布）。 */
export const buildHeroExport = (node: DesignNode): ExportElement => {
  const props = node.props ?? {}
  const children: ExportElement[] = [
    { tag: 'h2', attrs: {}, style: { ...HERO_TITLE_STYLE }, text: typeof props.title === 'string' ? props.title : '' },
  ]
  if (typeof props.subtitle === 'string' && props.subtitle) {
    children.push({ tag: 'p', attrs: {}, style: { ...HERO_SUBTITLE_STYLE }, text: props.subtitle })
  }
  const cta = props.cta as { text?: unknown } | undefined
  if (cta && typeof cta.text === 'string' && cta.text) {
    children.push({ tag: 'button', attrs: {}, style: { ...HERO_CTA_STYLE }, text: cta.text })
  }
  return { tag: 'section', attrs: {}, style: { ...HERO_DEFAULT_STYLE, ...styleToCss(node.style) }, children }
}
