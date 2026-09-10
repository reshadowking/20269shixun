/**
 * 方案缩略图（缺陷 1）：复用画布渲染层的只读投影，不污染画布测试选择器。
 */
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import DesignThumbnail from './DesignThumbnail'
import type { DesignNode } from '@/design/types'

const DESIGN: DesignNode = {
  id: 'root',
  type: 'frame',
  style: { layout: 'column', width: 800, height: 600, background: '#F5F5F5' },
  children: [
    { id: 'title', type: 'text', props: { text: '方案预览标题' }, style: { fontSize: 28 } },
    { id: 'btn', type: 'component', componentType: 'button', props: { text: '立即领取' } },
  ],
}

describe('DesignThumbnail', () => {
  it('渲染真实设计内容（文本可见）', () => {
    render(<DesignThumbnail design={DESIGN} testId="thumb" />)
    expect(screen.getByTestId('thumb')).toBeInTheDocument()
    expect(screen.getByText('方案预览标题')).toBeInTheDocument()
  })

  it('只读投影：不输出 node-* 选择器与 data-node-id（避免与画布冲突）', () => {
    const { container } = render(<DesignThumbnail design={DESIGN} testId="thumb" />)
    expect(container.querySelectorAll('[data-testid^="node-"]')).toHaveLength(0)
    expect(container.querySelectorAll('[data-node-id]')).toHaveLength(0)
  })

  it('按画布尺寸等比缩放（transform: scale）且容器尺寸固定', () => {
    const { container } = render(<DesignThumbnail design={DESIGN} width={160} height={100} testId="thumb" />)
    const scaler = container.querySelector('[data-thumbnail="true"] > div') as HTMLElement
    expect(scaler.style.transform).toMatch(/scale\(0\.16/) // min(160/800, 100/600) = 1/6（受高度约束）
    const box = screen.getByTestId('thumb')
    expect(box.style.width).toBe('160px')
    expect(box.style.height).toBe('100px')
  })
})
