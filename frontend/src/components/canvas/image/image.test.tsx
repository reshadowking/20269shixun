/**
 * 图片 fit 切换交互测试（缺陷 4）：hover 按钮循环切换 cover/contain/fill 并写回。
 */
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { CanvasImage } from './index'

describe('CanvasImage（P0-8 缺陷 4）', () => {
  it('无图时显示占位', () => {
    render(<CanvasImage props={{}} />)
    expect(screen.getByText(/未设置图片/)).toBeInTheDocument()
  })

  it('hover 显示 fit 切换按钮，点击循环并回调写回', () => {
    const onPropsChange = vi.fn()
    render(<CanvasImage props={{ src: 'https://x/img.png', fit: 'cover' }} onPropsChange={onPropsChange} />)
    fireEvent.mouseEnter(screen.getByRole('img'))
    const btn = screen.getByTestId('image-fit-switch')
    expect(btn).toHaveTextContent('裁剪填充')
    fireEvent.click(btn)
    expect(onPropsChange).toHaveBeenCalledWith('fit', 'contain')
  })

  it('非 cover 时按钮常显（提示用户当前显示模式）', () => {
    render(<CanvasImage props={{ src: 'https://x/img.png', fit: 'contain' }} onPropsChange={() => {}} />)
    expect(screen.getByTestId('image-fit-switch')).toHaveTextContent('完整显示')
  })
})
