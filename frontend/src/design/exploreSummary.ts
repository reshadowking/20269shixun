/**
 * 方案摘要与对比（缺陷 1）：纯函数、零模型调用——决策预览的数据来源。
 * 缩略图由 DesignThumbnail 复用画布渲染层给出；此处补"一句话定位 + 关键差异点"。
 */
import { componentRegistry } from '@/components/canvas/registry'
import { resolveColor } from '@/design/styleToCss'
import type { DesignNode } from '@/design/types'

const LAYOUT_LABELS: Record<string, string> = {
  row: '横向分栏',
  column: '纵向分栏',
  grid: '网格布局',
  free: '自由画布',
}

export interface ExploreDigest {
  layout: string
  theme: '深色系' | '浅色系'
  /** 一级模块数（根节点下可见子节点） */
  modules: number
  /** 特色组件中文名（按出现顺序，最多 3 个） */
  features: string[]
  maxFontSize: number
  /** 首个饱和业务色（无则 —） */
  accent: string
}

export interface ExploreComparable {
  label: string
  design: DesignNode
  compliance?: number
}

function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex.trim())
  if (!m) return null
  const n = parseInt(m[1], 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** 相对亮度（WCAG）；非 hex 返回 null */
export function luminance(hex: string): number | null {
  const rgb = hexToRgb(hex)
  if (!rgb) return null
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function saturation(hex: string): number {
  const rgb = hexToRgb(hex)
  if (!rgb) return 0
  const max = Math.max(...rgb)
  const min = Math.min(...rgb)
  return max === 0 ? 0 : (max - min) / max
}

/** 深度优先收集渲染顺序上的颜色/组件/字号（只统计可见节点） */
function walk(node: DesignNode, visit: (n: DesignNode) => void): void {
  visit(node)
  for (const child of node.children ?? []) {
    if (child.hidden) continue
    walk(child, visit)
  }
}

export function summarizeDesign(design: DesignNode): ExploreDigest {
  const backgrounds: string[] = []
  const colors: string[] = []
  const componentTypes: string[] = []
  let maxFontSize = 0
  let modules = 0

  walk(design, (n) => {
    const style = n.style ?? {}
    for (const raw of [style.background, n.type === 'rect' ? style.background : undefined]) {
      const resolved = resolveColor(raw)
      if (resolved) backgrounds.push(resolved)
    }
    const fg = resolveColor(style.color)
    if (fg) colors.push(fg)
    if (n.componentType && !componentTypes.includes(n.componentType)) componentTypes.push(n.componentType)
    if (typeof style.fontSize === 'number') maxFontSize = Math.max(maxFontSize, style.fontSize)
  })
  modules = (design.children ?? []).filter((c) => !c.hidden).length

  // 色调：以渲染顺序上第一个有背景色的节点为准（根容器无背景时取首个模块的背景）
  const firstBg = backgrounds.find((c) => luminance(c) !== null)
  const lum = firstBg ? luminance(firstBg) : null
  const theme: ExploreDigest['theme'] = lum !== null && lum < 0.35 ? '深色系' : '浅色系'

  // 业务色：首个足够饱和的颜色（过滤白/黑/灰/描边色）
  const accent = [...backgrounds, ...colors].find((c) => saturation(c) > 0.2) ?? '—'

  const features = componentTypes
    .slice(0, 3)
    .map((t) => componentRegistry[t]?.label ?? t)

  return {
    layout: LAYOUT_LABELS[design.style?.layout ?? ''] ?? '自由布局',
    theme,
    modules,
    features,
    maxFontSize,
    accent,
  }
}

/** 一句话定位：布局 · 色调 · 特色组件 */
export function optionPositioning(input: ExploreComparable): string {
  const d = summarizeDesign(input.design)
  const parts = [d.layout, d.theme]
  if (d.accent !== '—') parts.push(`主色 ${d.accent}`)
  if (d.features.length > 0) parts.push(`含${d.features.join('、')}`)
  return parts.join(' · ')
}

/** 方案短名（"方案一 · 默认风格" → "方案一"） */
export function shortLabel(label: string): string {
  return label.split('·')[0].trim() || label
}

/**
 * 关键差异点：固定给出 3 条基础维度（布局/色调/模块数，相同也明说），
 * 再按差异补充最多 2 条（组件构成 / 兼容率或字号），保证 3~5 条。
 */
export function compareOptions(a: ExploreComparable, b: ExploreComparable): string[] {
  const da = summarizeDesign(a.design)
  const db = summarizeDesign(b.design)
  const [na, nb] = [shortLabel(a.label), shortLabel(b.label)]
  const lines: string[] = []

  lines.push(
    da.layout === db.layout
      ? `布局相同：均为${da.layout}`
      : `布局：${na} ${da.layout} / ${nb} ${db.layout}`,
  )
  lines.push(
    da.theme === db.theme ? `色调相同：均为${da.theme}` : `色调：${na} ${da.theme} / ${nb} ${db.theme}`,
  )
  lines.push(
    da.modules === db.modules
      ? `一级模块数相同：均 ${da.modules} 个`
      : `一级模块数：${na} ${da.modules} 个 / ${nb} ${db.modules} 个`,
  )

  const [fa, fb] = [da.features.join('、') || '无特色组件', db.features.join('、') || '无特色组件']
  if (fa !== fb) lines.push(`组件构成：${na} ${fa} / ${nb} ${fb}`)

  if (typeof a.compliance === 'number' && typeof b.compliance === 'number' && a.compliance !== b.compliance) {
    lines.push(`规范兼容率：${na} ${a.compliance}% / ${nb} ${b.compliance}%`)
  } else if (da.maxFontSize !== db.maxFontSize) {
    lines.push(`最大字号：${na} ${da.maxFontSize || '—'} / ${nb} ${db.maxFontSize || '—'}`)
  } else if (a.design.style?.layout !== b.design.style?.layout) {
    lines.push(`画布尺寸：${na} / ${nb} 见缩略图`)
  }

  // 保底 3~5 条：不足 3 条时用"相同点"补齐（明示相同，不编造差异）
  while (lines.length < 3) lines.push(`已对比维度相同：布局、色调、模块数`)
  return lines.slice(0, 5)
}
