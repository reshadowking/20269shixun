import { useState } from 'react'

import type { ExportElement } from '@/components/canvas/types'
import { IMAGE_DEFAULT_STYLE, IMAGE_PLACEHOLDER_CANVAS_STYLE, IMAGE_PLACEHOLDER_STYLE } from '@/components/canvas/styleTokens'
import { escapeHtml, safeSrc } from '@/design/escape'
import { styleToCss } from '@/design/styleToCss'
import type { DesignNode } from '@/design/types'

const FIT_CYCLE = ['cover', 'contain', 'fill'] as const
const FIT_LABEL: Record<string, string> = { cover: '裁剪填充', contain: '完整显示', fill: '拉伸填充' }

/** ① 画布渲染：图片（缺陷 4——hover 右上角切换填充方式，完整显示/裁剪/拉伸） */
export function CanvasImage({ props, style, onPropsChange }: { props: Record<string, unknown>; style?: React.CSSProperties; onPropsChange?: (key: string, value: unknown) => void }) {
  const src = typeof props.src === 'string' ? props.src : ''
  const alt = typeof props.alt === 'string' ? props.alt : '图片'
  const fit = typeof props.fit === 'string' ? props.fit : 'cover'
  const [hover, setHover] = useState(false)
  if (!src) {
    // 空态占位（T12-B：默认观感内联，画布/导出共用 IMAGE_PLACEHOLDER_STYLE；导出为 img 只能复用盒子）
    return (
      <div style={{ ...IMAGE_PLACEHOLDER_STYLE, ...IMAGE_PLACEHOLDER_CANVAS_STYLE, width: '100%', ...(style as object) }}>
        图片组件 · 未设置图片
      </div>
    )
  }
  const nextFit = (): void => {
    const idx = FIT_CYCLE.indexOf(fit as (typeof FIT_CYCLE)[number])
    const next = FIT_CYCLE[(idx + 1) % FIT_CYCLE.length]
    onPropsChange?.('fit', next)
  }
  return (
    <div
      className="group"
      style={{ position: 'relative', overflow: 'visible', ...(style as object) }}
      onPointerDown={(e) => e.stopPropagation()}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <img
        src={src}
        alt={alt}
        style={{ ...IMAGE_DEFAULT_STYLE, objectFit: fit as React.CSSProperties['objectFit'] }}
        draggable={false}
      />
      {(hover || fit !== 'cover') && (
        <button
          type="button"
          className="absolute right-1 top-1 z-10 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white shadow hover:bg-black/80"
          data-testid="image-fit-switch"
          title="切换图片填充方式（裁剪/完整/拉伸）"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation()
            nextFit()
          }}
        >
          {FIT_LABEL[fit] ?? fit} ↻
        </button>
      )}
    </div>
  )
}

/** ② props 类型 */
export interface ImageProps {
  src?: string
  alt?: string
  width?: number | string
  height?: number | string
  fit?: 'cover' | 'contain' | 'fill'
}

/** ③ 导出模板（阶段 4 图片转 base64 内联；当前输出 src） */
// 已废弃（B5，B1-2 全量迁移后）：导出统一走下方 buildExport（React/HTML 引擎消费）；本字符串模板函数不再被注册表引用，待二期删除。
export const exportImageTemplate = (props: Record<string, unknown>): string => {
  const src = escapeHtml(typeof props.src === 'string' ? props.src : '')
  const alt = escapeHtml(typeof props.alt === 'string' ? props.alt : '图片')
  const fit = typeof props.fit === 'string' ? props.fit : 'cover'
  if (!src) return '        {/* 图片组件：未设置图片 */}'
  return `        <img src="${src}" alt="${alt}" className="w-full rounded-md" style={{ objectFit: '${fit}' }} />`
}

/** B1 试点：导出语义描述——src 在此完成协议白名单（safeSrc），引擎负责属性转义。
 * T12-B：① fit 映射为 objectFit（此前 fit 不影响导出）；② 空 src 口径统一——画布是占位块，
 * 导出不再是裸 <img src="">，改为同款占位盒（虚线/圆角/muted 底），仍保持 img 标签
 * （三处标签对齐：eval COMPONENT_TAG=img）。与画布的差异：img 无法承载子文本，画布的
 * 「图片组件 · 未设置图片」提示在导出侧以浏览器 alt 文本兜底——有意为之。③ hover 切换 fit
 * 是交互态，静态导出不实现（注释声明，同 button hover 口径）。 */
export const buildImageExport = (node: DesignNode): ExportElement => {
  const props = node.props ?? {}
  const src = typeof props.src === 'string' ? props.src : ''
  const alt = typeof props.alt === 'string' ? props.alt : '图片'
  const fit = typeof props.fit === 'string' ? props.fit : 'cover'
  if (!src) {
    return {
      tag: 'img',
      attrs: { alt },
      style: { ...IMAGE_PLACEHOLDER_STYLE, width: '100%', ...styleToCss(node.style) },
    }
  }
  return {
    tag: 'img',
    attrs: { src: safeSrc(src), alt },
    style: {
      ...IMAGE_DEFAULT_STYLE,
      objectFit: fit as React.CSSProperties['objectFit'],
      ...styleToCss(node.style),
    },
  }
}

/** ④ 属性面板配置（src 用 upload 控件：D2 本地上传 → URL 写入 props.src） */
export const imageSchema = [
  { key: 'src', label: '图片', control: 'upload' as const },
  { key: 'alt', label: '替代文本', control: 'text' as const },
  { key: 'fit', label: '填充方式', control: 'select' as const, options: ['cover', 'contain', 'fill'] },
]
