/**
 * CanvasSelect 交互测试（缺陷 14）：点击展开选项、选中更新显示、冒泡阻断。
 */
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { CanvasSelect } from './index'

describe('CanvasSelect', () => {
  it('点击触发展开选项列表', () => {
    render(<CanvasSelect props={{ label: '城市', options: ['北京', '上海', '广州'] }} />)
    expect(screen.queryByTestId('canvas-select-list')).not.toBeInTheDocument()
    fireEvent.click(screen.getByTestId('canvas-select-trigger'))
    expect(screen.getByTestId('canvas-select-list')).toBeInTheDocument()
    expect(screen.getByTestId('canvas-select-option-北京')).toBeInTheDocument()
  })

  it('选中选项后显示选中值并收起列表', () => {
    render(<CanvasSelect props={{ placeholder: '请选择', options: ['北京', '上海'] }} />)
    fireEvent.click(screen.getByTestId('canvas-select-trigger'))
    fireEvent.click(screen.getByTestId('canvas-select-option-上海'))
    expect(screen.getByText('上海')).toBeInTheDocument()
    expect(screen.queryByTestId('canvas-select-list')).not.toBeInTheDocument()
  })

  it('pointerdown 阻断冒泡（不触发画布拖拽选中）', () => {
    const onParentPointerDown = vi.fn()
    render(
      <div onPointerDown={onParentPointerDown}>
        <CanvasSelect props={{ options: ['A'] }} />
      </div>,
    )
    fireEvent.pointerDown(screen.getByTestId('canvas-select'))
    expect(onParentPointerDown).not.toHaveBeenCalled()
  })

  it('无选项时显示空提示', () => {
    render(<CanvasSelect props={{ options: [] }} />)
    fireEvent.click(screen.getByTestId('canvas-select-trigger'))
    expect(screen.getByText('暂无选项')).toBeInTheDocument()
  })
})
