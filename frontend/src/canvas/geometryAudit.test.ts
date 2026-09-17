/**
 * T26：几何体检用例。jsdom 没有真实布局，按 freeze.test.ts 的既有做法手工 stub
 * getBoundingClientRect / scrollHeight / clientHeight。
 *
 * T42 隔离加固：所有用例都在**离屏树**上跑（自己建 root，不挂 document.body），
 * 并补了三条"确定性/隔离/容差"断言——这几条正是过去偶发红的地方：
 * 全量并行时若测量依赖了全局 DOM 或残留节点，断言就会时对时错。
 */
import { afterEach, describe, expect, it } from 'vitest'

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
  afterEach(() => {
    // 用例自带清理：即便某条断言失败，也不把噪声节点留给下一个用例
    document.querySelectorAll('[data-noisy]').forEach((el) => el.remove())
  })

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

  it('叶子控件（icon/divider/image）不算空容器（2026-09-17：此前会被误报）', () => {
    // 画布 DOM 只有 data-node-id，没有组件类型标记；用"子树里有没有控件标签"来判定
    const canvasEl = document.createElement('div')
    canvasEl.innerHTML = `
      <div data-node-id="icon1"><svg viewBox="0 0 24 24"><path d="M0 0h24v24H0z"/></svg></div>
      <hr data-node-id="divider1" />
      <img data-node-id="img1" alt="" />
      <input data-node-id="input1" />
      <div data-node-id="truly-empty"></div>`

    const empty = auditGeometry(canvasEl)
      .filter((i) => i.kind === 'empty-frame')
      .map((i) => i.nodeId)

    expect(empty).toEqual(['truly-empty'])
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

  it('T42：溢出容差是"闭区间"——正好等于 slack 不算问题，超过 1px 才算', () => {
    const build = (childWidth: number) => {
      const parent = node('root', { left: 0, top: 0, width: 200, height: 100 })
      const child = node('big', { left: 0, top: 0, width: childWidth, height: 40 })
      setText(parent, '标题')
      setText(child, '内容')
      parent.appendChild(child)
      return canvas(parent)
    }
    // 默认 overflowSlackPx = 2：200 + 2 恰好不算溢出
    expect(auditGeometry(build(202)).some((i) => i.kind === 'overflow')).toBe(false)
    expect(auditGeometry(build(203)).some((i) => i.kind === 'overflow')).toBe(true)
    // 显式放宽容差后，203 也放行（容差可配）
    expect(auditGeometry(build(203), { overflowSlackPx: 3 }).some((i) => i.kind === 'overflow')).toBe(false)
  })

  it('T42：文档里存在同 id 的噪声树 / 另一块 canvas-sheet 时，结果不变', () => {
    const parent = node('root', { left: 0, top: 0, width: 200, height: 100 })
    const child = node('big', { left: 10, top: 10, width: 400, height: 40 })
    setText(parent, '标题')
    setText(child, '很长的内容')
    parent.appendChild(child)
    const root = canvas(parent)

    const baseline = auditGeometry(root)
    expect(baseline.some((i) => i.kind === 'overflow')).toBe(true)

    const noise = document.createElement('div')
    noise.setAttribute('data-noisy', '1')
    // 同样的 data-node-id + 一个假的 canvas-sheet（模拟预览层/缩略图场景）
    noise.innerHTML =
      '<div data-testid="canvas-sheet"><div data-node-id="root"><div data-node-id="big">别的文本</div></div></div>'
    document.body.append(noise)

    expect(auditGeometry(root)).toEqual(baseline)
  })

  it('T42：同一输入重复体检 50 次，输出完全一致（顺序与内容都不漂）', () => {
    const card = node('card', { left: 0, top: 0, width: 200, height: 100 }, { backgroundColor: '#FFFFFF' })
    const bad = node('label', { left: 10, top: 10, width: 100, height: 20 }, { color: '#CCCCCC' })
    const overlap = node('other', { left: 50, top: 5, width: 100, height: 20 })
    setText(bad, '浅色说明')
    setText(overlap, '另一段')
    setText(card, '浅色说明 另一段')
    card.append(bad, overlap)
    const root = canvas(card)

    const first = auditGeometry(root)
    expect(first.length).toBeGreaterThan(0)
    for (let i = 0; i < 50; i++) {
      expect(auditGeometry(root)).toEqual(first)
    }
  })
})
