/**
 * T46a-3e：只读访客下，美化面板整块不可写（效果按钮 / 版面确认 / 解除锁定全部禁用）。
 * 这是验收方在浏览器里没条件点到的那一块的补测。
 */
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { DesignNode } from '@/design/types'

import BeautifyPanel from './BeautifyPanel'

const DESIGN: DesignNode = {
  id: 'root',
  type: 'frame',
  style: { layout: 'column', width: 800, height: 600 },
  children: [{ id: 'card-1', type: 'component', componentType: 'card', style: { width: 320 } }],
}

function renderPanel(overrides: Partial<React.ComponentProps<typeof BeautifyPanel>> = {}) {
  const props = {
    design: DESIGN,
    selectedNode: DESIGN.children![0],
    baseSnapshot: null,
    locked: false,
    applying: false,
    error: '',
    previewing: false,
    onConfirmLayout: vi.fn(),
    onUnlock: vi.fn(),
    onApplyEffect: vi.fn(),
    onPreviewToggle: vi.fn(),
    ...overrides,
  }
  render(<BeautifyPanel {...props} />)
  return props
}

describe('BeautifyPanel（T46a-3e 只读访客）', () => {
  it('效果与版面确认全部禁用，并给出只读说明', () => {
    renderPanel({ readOnly: true })

    expect(screen.getByTestId('beautify-readonly-note')).toHaveTextContent('只读访客')
    expect(screen.getByTestId('beautify-confirm')).toBeDisabled()
    // 效果白名单：每个分组的所有取值按钮都应禁用（含"关闭"）
    expect(screen.getByTestId('beautify-shadow-0')).toBeDisabled()
    expect(screen.getByTestId('beautify-shadow-off')).toBeDisabled()
    expect(screen.getByTestId('beautify-radius-0')).toBeDisabled()
  })

  it('已确认版面时「解除版面锁定」也禁用（不能靠解锁绕过只读）', () => {
    renderPanel({ readOnly: true, locked: true, baseSnapshot: { design: DESIGN, at: Date.now() } })
    expect(screen.getByTestId('beautify-unlock')).toBeDisabled()
  })

  it('可编辑（非只读）时按钮恢复可用——只读态没有污染正常路径', () => {
    renderPanel()
    expect(screen.getByTestId('beautify-confirm')).toBeEnabled()
    expect(screen.getByTestId('beautify-shadow-0')).toBeEnabled()
    expect(screen.queryByTestId('beautify-readonly-note')).not.toBeInTheDocument()
  })
})
