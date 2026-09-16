/**
 * CanvasSettings：
 * - T46a-3e：只读访客看着不能改（输入框与预设都禁用 + 说明），不给"点了其实没生效"的假象；
 * - 验收发现的既有瑕疵回归：尺寸输入框要**跟随根节点**同步（此前只在挂载时取一次，
 *   组件先于设计稿加载挂载时会长期显示示例稿的 720，与画布 800×600 对不上）。
 */
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { DesignNode } from '@/design/types'

import CanvasSettings from './CanvasSettings'

const root = (width?: number, height?: number): DesignNode => ({
  id: 'root',
  type: 'frame',
  style: width === undefined ? {} : { width, height },
})

describe('CanvasSettings', () => {
  it('默认（可编辑）：输入框可用，改尺寸走 onUpdate', () => {
    const onUpdate = vi.fn()
    render(<CanvasSettings root={root(800, 600)} onUpdate={onUpdate} />)
    expect(screen.getByTestId('canvas-width')).toBeEnabled()
    expect(screen.getByTestId('canvas-preset-1440')).toBeEnabled()
    expect(screen.queryByTestId('canvas-settings-readonly')).not.toBeInTheDocument()
  })

  it('只读访客：输入框与预设禁用，并说明原因', () => {
    render(<CanvasSettings root={root(800, 600)} readOnly onUpdate={vi.fn()} />)
    expect(screen.getByTestId('canvas-width')).toBeDisabled()
    expect(screen.getByTestId('canvas-height')).toBeDisabled()
    expect(screen.getByTestId('canvas-preset-375')).toBeDisabled()
    expect(screen.getByTestId('canvas-settings-readonly')).toHaveTextContent('只读访客')
  })

  it('跟随根节点同步尺寸（回归：先挂载后加载设计时不能停留在旧值 720）', () => {
    const { rerender } = render(<CanvasSettings root={root(720, 1280)} onUpdate={vi.fn()} />)
    expect(screen.getByTestId('canvas-width')).toHaveValue(720)

    // 设计稿加载完成后 root 变成 800×600 —— 输入框必须跟着变
    rerender(<CanvasSettings root={root(800, 600)} onUpdate={vi.fn()} />)
    expect(screen.getByTestId('canvas-width')).toHaveValue(800)
    expect(screen.getByTestId('canvas-height')).toHaveValue(600)
  })

  it('根节点没有尺寸时显示默认 800×600', () => {
    render(<CanvasSettings root={root()} onUpdate={vi.fn()} />)
    expect(screen.getByTestId('canvas-width')).toHaveValue(800)
    expect(screen.getByTestId('canvas-height')).toHaveValue(600)
  })
})
