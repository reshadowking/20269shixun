/**
 * 入场动效不再被高亮样式覆盖（T49 / C1）。
 *
 * 背景 bug：`common` 里曾写 `animation: isHighlighted ? '…pulse…' : undefined`，
 * 而 `common` 在 `{ ...styleToCss(style), ...common }` 中是**后展开**的 ——
 * 非高亮时那个 `undefined` 会把 `styleToCss` 从 `style.animation` 产出的动效覆盖掉，
 * 于是"入场动效"这个高级效果**永不生效**（写了、算改了、画面不动）。
 */
import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { DesignNode } from '@/design/types'

import { NodeRenderer } from './NodeRenderer'

function renderNode(node: DesignNode, highlightIds: Set<string> = new Set()) {
  render(<NodeRenderer node={node} selectedIds={new Set()} highlightIds={highlightIds} />)
  return document.querySelector(`[data-node-id="${node.id}"]`) as HTMLElement
}

const animated: DesignNode = {
  id: 'card',
  type: 'component',
  componentType: 'card',
  style: { animation: 'fade-in', width: 320 },
}

describe('NodeRenderer 的入场动效', () => {
  it('非高亮时节点自己的动效必须保留（回归：曾被 undefined 覆盖）', () => {
    const el = renderNode(animated)
    expect(el.style.animation).toContain('fade-in 0.6s ease-out both')
  })

  it('高亮时高亮动画优先（覆盖节点动效）', () => {
    const el = renderNode(animated, new Set(['card']))
    expect(el.style.animation).toContain('highlight-pulse')
    expect(el.style.animation).not.toContain('fade-in')
  })

  it('未设置动效的节点不会凭空多出 animation（不留 undefined 键）', () => {
    const el = renderNode({ id: 'plain', type: 'text', props: { text: 'hi' } })
    expect(el.style.animation).toBe('')
    expect(el.getAttribute('data-highlighted')).toBeNull()
  })

  it('非预置动效名一律不渲染（白名单外不生效，与 styleToCss 一致）', () => {
    const el = renderNode({ id: 'weird', type: 'text', props: { text: 'hi' }, style: { animation: 'fade-in 3s' } })
    expect(el.style.animation).toBe('')
  })
})
