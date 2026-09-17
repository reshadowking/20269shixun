/**
 * T26：几何体检（确定性规则，不调 LLM，纯只读——不修改设计树）。
 *
 * 输入带 `data-node-id` 的画布容器 DOM，输出问题清单：溢出 / 重叠 / 空容器 / 文字截断 / 对比度不足。
 * 测量口径与 freeze.ts 一致（getBoundingClientRect，border box）；颜色只读内联样式
 * （画布节点由 styleToCss 内联写入，真实运行与单测口径一致，不依赖 getComputedStyle）。
 */
export type AuditKind = 'overflow' | 'overlap' | 'empty-frame' | 'truncated-text' | 'low-contrast'

export interface AuditIssue {
  kind: AuditKind
  nodeId: string
  detail: string
}

export interface AuditOptions {
  /** 溢出容差（px），默认 2 */
  overflowSlackPx?: number
  /** 重叠面积占较小节点的比例阈值，默认 0.2 */
  overlapRatio?: number
  /** WCAG 最低对比度，默认 4.5 */
  contrastRatio?: number
}

const DEFAULTS = { overflowSlackPx: 2, overlapRatio: 0.2, contrastRatio: 4.5 }

/**
 * 叶子控件标签（2026-09-17 补）：icon(span>svg)、divider(hr)、image(img)、
 * input/select/table 这些**天然没有文本**。
 *
 * 背景：`empty-frame` 规则原文是"容器内没有可见文本"，但它对**所有** `[data-node-id]` 都生效，
 * 于是实测把 `icon1 / divider1 / img1` 也报成"空容器"（画布上 DOM 只有 `data-node-id`、
 * 没有组件类型标记，无法按类型过滤）。现在改判据：子树里带控件标签的元素不算"空容器"。
 * 代价是"只放按钮的 frame"不再被报——宁可少报，也不要把图标/分割线当问题报出来。
 */
const WIDGET_SELECTOR = 'svg,img,hr,input,button,select,textarea,table,canvas'

type Rgb = [number, number, number]

function parseColor(value: string | null | undefined): Rgb | null {
  if (!value) return null
  const v = value.trim().toLowerCase()
  if (v === 'white') return [255, 255, 255]
  if (v === 'black') return [0, 0, 0]
  if (v.startsWith('#')) {
    const hex = v.slice(1)
    if (hex.length === 3) return [0, 1, 2].map((i) => parseInt(hex[i] + hex[i], 16)) as Rgb
    if (hex.length === 6) return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)) as Rgb
    return null
  }
  const fn = v.match(/^rgba?\(([^)]+)\)$/)
  if (fn) {
    const parts = fn[1].split(',').map((s) => parseFloat(s))
    if (parts.length >= 3 && parts.slice(0, 3).every((n) => Number.isFinite(n))) return [parts[0], parts[1], parts[2]]
  }
  return null
}

function luminance([r, g, b]: Rgb): number {
  const channel = (c: number) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

function contrastRatio(a: Rgb, b: Rgb): number {
  const [la, lb] = [luminance(a), luminance(b)]
  const [hi, lo] = la > lb ? [la, lb] : [lb, la]
  return (hi + 0.05) / (lo + 0.05)
}

/** 最近的有背景色的祖先（内联样式，向父级回溯）。 */
function backgroundOf(el: HTMLElement | null): Rgb | null {
  let cur: HTMLElement | null = el
  while (cur) {
    const bg = parseColor(cur.style.backgroundColor)
    if (bg) return bg
    cur = cur.parentElement
  }
  return null
}

function overlapRatio(a: DOMRect, b: DOMRect): number {
  const w = Math.min(a.right, b.right) - Math.max(a.left, b.left)
  const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
  if (w <= 0 || h <= 0) return 0
  const smaller = Math.min(a.width * a.height, b.width * b.height)
  return smaller > 0 ? (w * h) / smaller : 0
}

function nodeIdOf(el: HTMLElement): string {
  return el.dataset.nodeId ?? ''
}

export function auditGeometry(root: HTMLElement, options: AuditOptions = {}): AuditIssue[] {
  const opts = { ...DEFAULTS, ...options }
  const issues: AuditIssue[] = []
  const nodes = Array.from(root.querySelectorAll<HTMLElement>('[data-node-id]'))

  for (const el of nodes) {
    const nodeId = nodeIdOf(el)
    const rect = el.getBoundingClientRect()
    const rectChildren = Array.from(el.children).filter(
      (c): c is HTMLElement => c instanceof HTMLElement && Boolean(c.dataset.nodeId),
    )

    // ① 溢出容器：子节点超出父容器可视范围
    const overflowed = rectChildren.find((child) => {
      const cr = child.getBoundingClientRect()
      return (
        cr.right > rect.right + opts.overflowSlackPx ||
        cr.bottom > rect.bottom + opts.overflowSlackPx ||
        cr.left < rect.left - opts.overflowSlackPx ||
        cr.top < rect.top - opts.overflowSlackPx
      )
    })
    if (overflowed) {
      issues.push({ kind: 'overflow', nodeId, detail: `${nodeIdOf(overflowed)} 超出容器边界` })
    }

    // ② 空容器：没有任何可见文本，且**不含叶子控件**（icon/divider/image/表单控件自带内容）
    const hasWidget = el.matches(WIDGET_SELECTOR) || Boolean(el.querySelector(WIDGET_SELECTOR))
    if (!hasWidget && !(el.textContent ?? '').trim()) {
      issues.push({ kind: 'empty-frame', nodeId, detail: '容器内没有可见文本' })
    }

    // ③ 文字截断：内容高度超过可视高度
    if (el.clientHeight > 0 && el.scrollHeight > el.clientHeight + opts.overflowSlackPx) {
      issues.push({
        kind: 'truncated-text',
        nodeId,
        detail: `内容 ${el.scrollHeight}px 超过可视 ${el.clientHeight}px`,
      })
    }

    // ④ 对比度：前景 vs 最近的背景
    const fg = parseColor(el.style.color)
    const bg = fg ? backgroundOf(el.parentElement) : null
    if (fg && bg) {
      const ratio = contrastRatio(fg, bg)
      if (ratio < opts.contrastRatio) {
        issues.push({ kind: 'low-contrast', nodeId, detail: `对比度 ${ratio.toFixed(2)}:1 低于 ${opts.contrastRatio}:1` })
      }
    }

    // ⑤ 重叠：同父下的兄弟节点两两比较
    const siblings = Array.from(el.parentElement?.children ?? []).filter(
      (c): c is HTMLElement => c instanceof HTMLElement && c !== el && Boolean(c.dataset.nodeId),
    )
    // 只由 id 较小的一方上报，避免一对节点产生两条重复记录
    const overlapped = siblings
      .filter((other) => nodeIdOf(other) > nodeId)
      .find((other) => overlapRatio(rect, other.getBoundingClientRect()) > opts.overlapRatio)
    if (overlapped) {
      issues.push({ kind: 'overlap', nodeId, detail: `与 ${nodeIdOf(overlapped)} 重叠` })
    }
  }
  return issues
}
