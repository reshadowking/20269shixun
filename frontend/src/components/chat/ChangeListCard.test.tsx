/**
 * 变更清单卡片交互测试（T49 交付 2）。
 *
 * 锁住四条与用户直接相关的行为：
 * - 改动多时**默认折叠**（否则占满聊天界面），可展开；
 * - 悬停某条 → 高亮画布对应节点；**删除项不高亮**（节点已不存在）；
 * - 单条「撤回此项」；已撤回的置灰但**不消失**（列表不跳动，索引稳定）；
 * - `revertBlocked` 的条目**不给按钮**，只说明要用 Ctrl+Z（不让单条按钮触发全局撤销）。
 */
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { ChangeItem } from '@/design/changeList'

import ChangeListCard from './ChangeListCard'

function item(over: Partial<ChangeItem> & { id: string }): ChangeItem {
  return {
    title: over.title ?? over.id,
    kind: 'modified',
    fields: [{ scope: 'style', key: 'shadow', from: '无', to: '0 4px 12px' }],
    summary: '阴影 无 → 0 4px 12px',
    hasEffective: true,
    allIneffective: false,
    revert: { removed: [], moved: [], updated: [], added: [], orders: [] },
    ...over,
  }
}

describe('折叠', () => {
  it('3 条以内默认展开，全部可见', () => {
    const items = [item({ id: 'a' }), item({ id: 'b' }), item({ id: 'c' })]
    render(<ChangeListCard items={items} onRevert={() => {}} />)
    expect(screen.getByTestId('change-list-toggle')).toHaveTextContent('改动 3 条')
    expect(screen.getByTestId('change-item-2')).toBeInTheDocument()
  })

  it('超过 3 条默认折叠，点一下展开', () => {
    const items = ['a', 'b', 'c', 'd', 'e'].map((id) => item({ id }))
    render(<ChangeListCard items={items} onRevert={() => {}} />)
    expect(screen.queryByTestId('change-item-4')).toBeNull()
    fireEvent.click(screen.getByTestId('change-list-toggle'))
    expect(screen.getByTestId('change-item-4')).toBeInTheDocument()
  })

  it('折叠时可一键展开其余', () => {
    const items = ['a', 'b', 'c', 'd'].map((id) => item({ id }))
    render(<ChangeListCard items={items} onRevert={() => {}} />)
    fireEvent.click(screen.getByText(/展开其余 2 条/))
    expect(screen.getByTestId('change-item-3')).toBeInTheDocument()
  })
})

describe('悬停高亮', () => {
  it('悬停普通条目 → 高亮该节点；移出 → 取消高亮', () => {
    const onHighlight = vi.fn()
    render(<ChangeListCard items={[item({ id: 'c1', title: '优惠券卡' })]} onRevert={() => {}} onHighlight={onHighlight} />)
    fireEvent.mouseEnter(screen.getByTestId('change-item-0'))
    expect(onHighlight).toHaveBeenLastCalledWith(['c1'])
    fireEvent.mouseLeave(screen.getByTestId('change-item-0'))
    expect(onHighlight).toHaveBeenLastCalledWith([])
  })

  it('**删除项悬停不高亮**（节点已不存在，传 id 会指到别的东西）', () => {
    const onHighlight = vi.fn()
    render(
      <ChangeListCard
        items={[item({ id: 'gone', kind: 'removed', summary: '删除（card）', fields: [] })]}
        onRevert={() => {}}
        onHighlight={onHighlight}
      />,
    )
    fireEvent.mouseEnter(screen.getByTestId('change-item-0'))
    expect(onHighlight).not.toHaveBeenCalled()
  })
})

describe('单条撤回', () => {
  it('点「撤回此项」把该条交给上层', () => {
    const onRevert = vi.fn()
    const target = item({ id: 'c1' })
    render(<ChangeListCard items={[target]} onRevert={onRevert} />)
    fireEvent.click(screen.getByTestId('change-revert-0'))
    expect(onRevert).toHaveBeenCalledWith(target)
  })

  it('已撤回的条目置灰、不消失、且没有按钮（列表不跳动）', () => {
    const items = [item({ id: 'c1' }), item({ id: 'c2' })]
    render(<ChangeListCard items={items} onRevert={() => {}} revertedIds={['c1']} />)
    expect(screen.queryByTestId('change-revert-0')).toBeNull()
    expect(screen.getByText('已撤回')).toBeInTheDocument()
    expect(screen.getByTestId('change-item-0')).toBeInTheDocument()
    expect(screen.getByTestId('change-revert-1')).toBeInTheDocument() // 另一条不受影响
  })

  it('revertBlocked 的条目不给按钮，只说明用 Ctrl+Z', () => {
    render(
      <ChangeListCard
        items={[item({ id: 'c1', kind: 'moved', fields: [], summary: '移动到「B」', revertBlocked: '原父级已删除，需用 Ctrl+Z 整体撤销' })]}
        onRevert={() => {}}
      />,
    )
    expect(screen.queryByTestId('change-revert-0')).toBeNull()
    expect(screen.getByTestId('change-blocked-0')).toHaveTextContent('Ctrl+Z')
  })
})

describe('未生效字段的标注', () => {
  it('字段级 ineffective 在行内以琥珀色提示出来，但条目仍可撤回', () => {
    const target = item({
      id: 'c1',
      fields: [
        { scope: 'style', key: 'shadow', from: '无', to: 'x' },
        { scope: 'style', key: 'boxSizing', from: '无', to: 'border-box', ineffective: '渲染层不支持这个样式键' },
      ],
      hasEffective: true,
    })
    render(<ChangeListCard items={[target]} onRevert={() => {}} />)
    expect(screen.getByText('渲染层不支持这个样式键')).toBeInTheDocument()
    expect(screen.getByTestId('change-revert-0')).toBeInTheDocument() // 有效字段确实改了 → 可撤回
  })
})

describe('反馈闭环（T51 批2）', () => {
  const feedbackItems = [item({ id: 'c1' })]

  it('选了 👍 才出现原因选择与提交按钮', () => {
    render(<ChangeListCard items={feedbackItems} onRevert={() => {}} onFeedback={async () => true} />)
    expect(screen.queryByTestId('feedback-category')).toBeNull()
    fireEvent.click(screen.getByTestId('feedback-up'))
    expect(screen.getByTestId('feedback-category')).toBeInTheDocument()
    expect(screen.getByTestId('feedback-submit')).toBeInTheDocument()
  })

  it('category 是**单选**（下拉，一条反馈一个主因）', () => {
    render(<ChangeListCard items={feedbackItems} onRevert={() => {}} onFeedback={async () => true} />)
    fireEvent.click(screen.getByTestId('feedback-up'))
    const select = screen.getByTestId('feedback-category') as HTMLSelectElement
    expect(select.multiple).toBe(false)
    expect(select.options.length).toBe(6) // 1 占位 + 5 类
  })

  it('没传 onFeedback 时不显示反馈区', () => {
    render(<ChangeListCard items={feedbackItems} onRevert={() => {}} />)
    expect(screen.queryByTestId('feedback-bar')).toBeNull()
  })

  it('提交成功 → 显示已记录，onFeedback 收到 rating/category', async () => {
    const onFeedback = vi.fn(async () => true)
    render(<ChangeListCard items={feedbackItems} onRevert={() => {}} onFeedback={onFeedback} />)
    fireEvent.click(screen.getByTestId('feedback-up'))
    fireEvent.change(screen.getByTestId('feedback-category'), { target: { value: 'not_applied' } })
    fireEvent.click(screen.getByTestId('feedback-submit'))
    expect(await screen.findByTestId('feedback-done')).toBeInTheDocument()
    expect(onFeedback).toHaveBeenCalledWith({ rating: 1, category: 'not_applied' })
  })

  it('提交失败 → **不置灰**、保留选择、可重试', async () => {
    let fail = true
    const onFeedback = vi.fn(async () => !fail)
    render(<ChangeListCard items={feedbackItems} onRevert={() => {}} onFeedback={onFeedback} />)
    fireEvent.click(screen.getByTestId('feedback-down'))
    fireEvent.click(screen.getByTestId('feedback-submit'))
    expect(await screen.findByTestId('feedback-failed')).toHaveTextContent('提交失败，可重试')
    expect(screen.getByTestId('change-item-0')).not.toHaveClass('line-through')
    // 重试成功
    fail = false
    fireEvent.click(screen.getByTestId('feedback-submit'))
    expect(await screen.findByTestId('feedback-done')).toBeInTheDocument()
  })

  it('提交中禁用提交按钮（防双击重复落库）', async () => {
    let resolveSubmit: (ok: boolean) => void = () => {}
    const onFeedback = vi.fn(
      () => new Promise<boolean>((resolve) => { resolveSubmit = resolve }),
    )
    render(<ChangeListCard items={feedbackItems} onRevert={() => {}} onFeedback={onFeedback} />)
    fireEvent.click(screen.getByTestId('feedback-up'))
    fireEvent.click(screen.getByTestId('feedback-submit'))
    expect(screen.getByTestId('feedback-submit')).toBeDisabled()
    resolveSubmit(true)
    expect(await screen.findByTestId('feedback-done')).toBeInTheDocument()
  })
})
