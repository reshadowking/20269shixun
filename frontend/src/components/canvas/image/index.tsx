import { useState } from 'react'

import type { ExportElement } from '@/components/canvas/types'
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
    return (
      <div className="flex h-40 w-full items-center justify-center rounded-md border border-dashed bg-muted/30 text-xs text-muted-foreground" style={style as object}>
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
      className="group relative overflow-visible"
      style={{ ...(style as object), overflow: 'visible' }}
      onPointerDown={(e) => e.stopPropagation()}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <img
        src={src}
        alt={alt}
        className="w-full rounded-md"
        style={{ objectFit: fit as React.CSSProperties['objectFit'], display: 'block' }}
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
export const exportImageTemplate = (props: Record<string, unknown>): string => {
  const src = escapeHtml(typeof props.src === 'string' ? props.src : '')
  const alt = escapeHtml(typeof props.alt === 'string' ? props.alt : '图片')
  const fit = typeof props.fit === 'string' ? props.fit : 'cover'
  if (!src) return '        {/* 图片组件：未设置图片 */}'
  return `        <img src="${src}" alt="${alt}" className="w-full rounded-md" style={{ objectFit: '${fit}' }} />`
}

/** B1 试点：导出语义描述——src 在此完成协议白名单（safeSrc），引擎负责属性转义 */
export const buildImageExport = (node: DesignNode): ExportElement => {
  const props = node.props ?? {}
  return {
    tag: 'img',
    attrs: {
      src: safeSrc(typeof props.src === 'string' ? props.src : ''),
      alt: typeof props.alt === 'string' ? props.alt : '图片',
    },
    style: styleToCss(node.style),
  }
}

/** ④ 属性面板配置（上传控件阶段 5 接入） */
export const imageSchema = [
  { key: 'src', label: '图片 URL', control: 'text' as const },
  { key: 'alt', label: '替代文本', control: 'text' as const },
  { key: 'fit', label: '填充方式', control: 'select' as const, options: ['cover', 'contain', 'fill'] },
]
