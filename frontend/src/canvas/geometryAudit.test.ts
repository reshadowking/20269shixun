/**
 * T26：几何体检用例。jsdom 没有真实布局，按 freeze.test.ts 的既有做法手工 stub
 * getBoundingClientRect / scrollHeight / clientHeight。
 */
import { describe, expect, it } from 'vitest'

import { auditGeometry } from './geometryAudit'

type Rect = { left: number; top: number; width: number; height: number }

function node(id: string, rect: Rect, style: Partial<CSSStyleDeclaration> = {}): HTMLElement {
  const el = document.createElement('div')
  el.dataset.nodeId = id
  el.getBoundingClientRect = () =>
    ({
      left: rect.left,
      top: rect.top,
      right: rect.left + rect.width,
      bottom: rect.top + rect.height,
      width: rect.width,
      height: rect.height,
    }) as DOMRect
  Object.assign(el.style, style)
  return el
}

function canvas(...children: HTMLElement[]): HTMLElement {
  const root = document.createElement('div')
  for (const child of children) root.appendChild(child)
  return root
}

function setText(el: HTMLElement, text: string) {
  el.textContent = text
}

describe('auditGeometry', () => {
  it('溢出：子节点超出父容器 → overflow', () => {
    const parent = node('root', { left: 0, top: 0, width: 200, height: 100 })
    const child = node('big', { left: 10, top: 10, width: 400, height: 40 })
    setText(child, '很长的内容')
    setText(parent, '标题')
    parent.appendChild(child)
    const issues = auditGeometry(canvas(parent))
    expect(issues.some((i) => i.kind === 'overflow' && i.nodeId === 'root' && i.detail.includes('big'))).toBe(true)
  })

  it('重叠：兄弟节点重叠面积超过阈值 → overlap', () => {
    const a = node('a', { left: 0, top: 0, width: 100, height: 100 })
    const b = node('b', { left: 50, top: 0, width: 100, height: 100 })
    setText(a, 'A')
    setText(b, 'B')
    const issues = auditGeometry(canvas(a, b))
    expect(issues.filter((i) => i.kind === 'overlap').length).toBe(1)
  })

  it('空容器：没有可见文本 → empty-frame', () => {
    const el = node('empty', { left: 0, top: 0, width: 100, height: 50 })
    const issues = auditGeometry(canvas(el))
    expect(issues.some((i) => i.kind === 'empty-frame' && i.nodeId === 'empty')).toBe(true)
  })

  it('文字截断：内容高度超过可视高度 → truncated-text', () => {
    const el = node('text', { left: 0, top: 0, width: 100, height: 20 })
    setText(el, '两行文字被容器截断')
    Object.defineProperty(el, 'scrollHeight', { value: 60, configurable: true })
    Object.defineProperty(el, 'clientHeight', { value: 20, configurable: true })
    const issues = auditGeometry(canvas(el))
    expect(issues.some((i) => i.kind === 'truncated-text' && i.nodeId === 'text')).toBe(true)
  })

  it('对比度：浅灰字配白底 → low-contrast', () => {
    const card = node('card', { left: 0, top: 0, width: 200, height: 100 }, { backgroundColor: '#FFFFFF' })
    const label = node('label', { left: 10, top: 10, width: 100, height: 20 }, { color: '#CCCCCC' })
    setText(label, '浅色说明')
    setText(card, '浅色说明')
    card.appendChild(label)
    const issues = auditGeometry(canvas(card))
    expect(issues.some((i) => i.kind === 'low-contrast' && i.nodeId === 'label')).toBe(true)
  })

  it('健康画布：不产生任何问题（不误报）', () => {
    const card = node('card', { left: 0, top: 0, width: 200, height: 100 }, { backgroundColor: '#FFFFFF' })
    const title = node('title', { left: 10, top: 10, width: 100, height: 20 }, { color: '#1D2129' })
    setText(title, '标题')
    setText(card, '标题')
    Object.defineProperty(title, 'scrollHeight', { value: 20, configurable: true })
    Object.defineProperty(title, 'clientHeight', { value: 20, configurable: true })
    Object.defineProperty(card, 'scrollHeight', { value: 100, configurable: true })
    Object.defineProperty(card, 'clientHeight', { value: 100, configurable: true })
    card.appendChild(title)
    expect(auditGeometry(canvas(card))).toEqual([])
  })

  it('阈值可配：提高对比度要求后同一画布出现 low-contrast', () => {
    const card = node('card', { left: 0, top: 0, width: 200, height: 100 }, { backgroundColor: '#FFFFFF' })
    // #949494 对白底约 3.0:1——在 4.5 阈值下判为不足，在 3.0 阈值下放行
    const title = node('t', { left: 0, top: 0, width: 100, height: 20 }, { color: '#949494' })
    setText(title, '灰字')
    setText(card, '灰字')
    card.appendChild(title)
    expect(auditGeometry(canvas(card), { contrastRatio: 4.5 }).some((i) => i.kind === 'low-contrast')).toBe(true)
    expect(auditGeometry(canvas(card), { contrastRatio: 3 }).some((i) => i.kind === 'low-contrast')).toBe(false)
  })
})
