/**
 * 缺陷 3 美化面板：版面确认入口、基础版对照、临时关闭全部效果、效果白名单预设。
 * （尺寸类效果的二次确认与写入在 WorkspacePage/真实栈 E2E 覆盖）
 */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import BeautifyPanel from './BeautifyPanel'
import type { DesignNode } from '@/design/types'

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

describe('BeautifyPanel（缺陷 3）', () => {
  it('未确认版面：提供「确认版面，进入美化」，点击触发回调', async () => {
    const props = renderPanel()
    await userEvent.click(screen.getByTestId('beautify-confirm'))
    expect(props.onConfirmLayout).toHaveBeenCalledTimes(1)
    expect(screen.queryByTestId('beautify-confirmed')).not.toBeInTheDocument()
  })

  it('已确认版面：显示基础版时间与锁定说明，可解除锁定', async () => {
    const props = renderPanel({ baseSnapshot: { design: DESIGN, at: Date.now() }, locked: true })
    expect(screen.getByTestId('beautify-confirmed')).toHaveTextContent('基础版已保留')
    expect(screen.getByTestId('beautify-lock-note')).toHaveTextContent('版面已锁定')
    await userEvent.click(screen.getByTestId('beautify-unlock'))
    expect(props.onUnlock).toHaveBeenCalledTimes(1)
  })

  /**
   * 2026-09-18（用户实测报过）：面板分支原本取决于 `baseSnapshot` 而不是 `locked`，
   * 于是**解锁后快照还在 → 面板永远停在"版面已锁定 / 解除版面锁定"**，
   * 用户看到的是"点了确认之后变成解除绑定，再按几次都没有变化"。
   * 现在分支只看真实锁状态；快照作为"对比原始版面"的基线继续保留。
   */
  it('解锁后（快照仍在）：回到「确认版面」分支，并提示基线仍可对比', () => {
    renderPanel({ baseSnapshot: { design: DESIGN, at: Date.now() }, locked: false })
    expect(screen.getByTestId('beautify-confirm')).toBeInTheDocument()
    expect(screen.queryByTestId('beautify-confirmed')).not.toBeInTheDocument()
    // 效果区那条说明是常驻元素，它也要跟着切回"尚未确认版面"
    expect(screen.getByTestId('beautify-lock-note')).toHaveTextContent('尚未确认版面')
    expect(screen.queryByTestId('lock-state')).not.toBeInTheDocument()
    expect(screen.getByTestId('beautify-base-kept')).toHaveTextContent('上次基础版仍保留')
  })

  it('对比原始版面：弹窗同时给出基础版与当前缩略图', async () => {
    renderPanel({ baseSnapshot: { design: DESIGN, at: Date.now() } })
    await userEvent.click(screen.getByTestId('beautify-compare'))
    expect(screen.getByTestId('beautify-compare-dialog')).toBeInTheDocument()
    expect(screen.getByTestId('beautify-thumb-base')).toBeInTheDocument()
    expect(screen.getByTestId('beautify-thumb-current')).toBeInTheDocument()
    await userEvent.click(screen.getByTestId('beautify-compare-close'))
    expect(screen.queryByTestId('beautify-compare-dialog')).not.toBeInTheDocument()
  })

  it('无基础版快照时禁用「对比」与「临时关闭全部效果」（不留空按钮）', () => {
    renderPanel()
    expect(screen.getByTestId('beautify-compare')).toBeDisabled()
    // shadcn Switch 用 aria-disabled 表达禁用（非原生 disabled 属性）
    expect(screen.getByTestId('beautify-preview-toggle')).toHaveAttribute('aria-disabled', 'true')
  })

  it('临时关闭全部高级效果：开关触发预览回调', async () => {
    const props = renderPanel({ baseSnapshot: { design: DESIGN, at: Date.now() } })
    await userEvent.click(screen.getByTestId('beautify-preview-toggle'))
    expect(props.onPreviewToggle).toHaveBeenCalledWith(true)
  })

  it('选中节点：六类效果预设齐全，点击回调携带 (nodeId, key, value)', async () => {
    const props = renderPanel()
    for (const key of ['backgroundImage', 'shadow', 'animation', 'radius', 'border', 'transform']) {
      expect(screen.getByTestId(`beautify-group-${key}`)).toBeInTheDocument()
    }
    await userEvent.click(screen.getByTestId('beautify-shadow-1'))
    expect(props.onApplyEffect).toHaveBeenCalledWith('card-1', 'shadow', '0 4px 12px rgba(29,33,41,0.10)')
    await userEvent.click(screen.getByTestId('beautify-radius-2'))
    expect(props.onApplyEffect).toHaveBeenCalledWith('card-1', 'radius', 24)
  })

  it('「关闭」按钮移除效果（value=null）', async () => {
    const props = renderPanel({ selectedNode: { ...DESIGN.children![0], style: { width: 320, shadow: '0 4px 12px rgba(29,33,41,0.10)' } } })
    await userEvent.click(screen.getByTestId('beautify-shadow-off'))
    expect(props.onApplyEffect).toHaveBeenCalledWith('card-1', 'shadow', null)
  })

  it('尺寸类效果明确标注「可能改变尺寸」', () => {
    renderPanel()
    expect(screen.getByTestId('beautify-group-border')).toHaveTextContent('可能改变尺寸')
    expect(screen.getByTestId('beautify-group-transform')).toHaveTextContent('可能改变尺寸')
    expect(screen.getByTestId('beautify-group-shadow')).not.toHaveTextContent('可能改变尺寸')
  })

  it('未选中节点：提示先选组件（不给无目标的效果按钮）', () => {
    renderPanel({ selectedNode: null })
    expect(screen.getByTestId('beautify-need-selection')).toBeInTheDocument()
    expect(screen.queryByTestId('beautify-group-shadow')).not.toBeInTheDocument()
  })

  it('写入被拒：面板展示错误原因', () => {
    renderPanel({ error: '效果被拒绝：美化阶段只允许样式白名单字段' })
    expect(screen.getByTestId('beautify-error')).toHaveTextContent('只允许样式白名单字段')
  })
})

describe('BeautifyPanel 批量美化（T4 批3）', () => {
  const MULTI_DESIGN: DesignNode = {
    id: 'root',
    type: 'frame',
    style: { layout: 'column' },
    children: [
      { id: 'card-1', type: 'component', componentType: 'card', style: { width: 320 } },
      { id: 'card-2', type: 'component', componentType: 'card', style: { width: 320 } },
      { id: 'card-3', type: 'component', componentType: 'card', style: { width: 320 }, hidden: true },
      { id: 'btn-1', type: 'component', componentType: 'button', style: {} },
    ],
  }

  function renderBatchPanel(overrides: Partial<React.ComponentProps<typeof BeautifyPanel>> = {}) {
    const props = {
      design: MULTI_DESIGN,
      selectedNode: MULTI_DESIGN.children![0],
      baseSnapshot: null,
      locked: true,
      applying: false,
      error: '',
      previewing: false,
      selectedIds: new Set<string>(['card-1', 'btn-1']),
      onConfirmLayout: vi.fn(),
      onUnlock: vi.fn(),
      onApplyEffect: vi.fn(),
      onApplyEffectBatch: vi.fn(),
      onPreviewToggle: vi.fn(),
      ...overrides,
    }
    render(<BeautifyPanel {...props} />)
    return props
  }

  it('同类节点影响范围：同 componentType 计数且排除隐藏（将应用到 N 个节点）', async () => {
    renderBatchPanel()
    await userEvent.click(screen.getByTestId('beautify-scope-same-type'))
    // card-1/2/3 同为 card，但 card-3 隐藏 → 影响范围 2
    expect(screen.getByTestId('beautify-batch-note')).toHaveTextContent('将应用到 2 个节点')
  })

  it('多选影响范围：选中集合计算（将应用到 N 个节点）', async () => {
    renderBatchPanel()
    await userEvent.click(screen.getByTestId('beautify-scope-multi'))
    expect(screen.getByTestId('beautify-batch-note')).toHaveTextContent('将应用到 2 个节点')
  })

  it('批量应用：点预设触发批量回调，携带全部目标 id 与效果值', async () => {
    const props = renderBatchPanel()
    await userEvent.click(screen.getByTestId('beautify-scope-same-type'))
    await userEvent.click(screen.getByTestId('beautify-shadow-1'))
    expect(props.onApplyEffectBatch).toHaveBeenCalledWith(
      ['card-1', 'card-2'],
      'shadow',
      '0 4px 12px rgba(29,33,41,0.10)',
    )
    expect(props.onApplyEffect).not.toHaveBeenCalled()
  })

  it('changesSize 效果批量应用前二次确认；取消则不调用（含影响范围提示）', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const props = renderBatchPanel()
    await userEvent.click(screen.getByTestId('beautify-scope-same-type'))
    await userEvent.click(screen.getByTestId('beautify-transform-0'))
    expect(confirmSpy).toHaveBeenCalledTimes(1)
    expect(confirmSpy.mock.calls[0][0]).toContain('2 个节点')
    expect(props.onApplyEffectBatch).not.toHaveBeenCalled()
    confirmSpy.mockRestore()
  })

  it('单节点路径不受批量入口影响：默认范围仍是当前节点、回调不变', async () => {
    const props = renderBatchPanel()
    await userEvent.click(screen.getByTestId('beautify-shadow-2'))
    expect(props.onApplyEffect).toHaveBeenCalledWith('card-1', 'shadow', '0 10px 30px rgba(29,33,41,0.16)')
    expect(props.onApplyEffectBatch).not.toHaveBeenCalled()
    expect(screen.queryByTestId('beautify-batch-note')).not.toBeInTheDocument()
  })
})
