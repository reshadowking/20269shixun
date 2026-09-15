/**
 * 会话栏（缺陷 4）：当前会话/列表（只读元信息）/新建/切换/删除 + 会话快照（4b）。
 */
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import SessionBar from './SessionBar'
import type { SessionMeta } from '@/lib/sessionApi'
import type { SessionSnapshot } from '@/lib/sessionSnapshots'

const SESSIONS: SessionMeta[] = [
  { session_id: 's-a', title: '优惠券页会话', design_id: null, created_at: null, updated_at: '2026-09-10T10:00:00' },
  { session_id: 's-b', title: '登录页会话', design_id: 12, created_at: null, updated_at: '2026-09-10T09:00:00' },
]

const SNAPSHOTS: SessionSnapshot[] = [
  { id: 'snap-1', at: Date.now(), label: '初稿', design: { id: 'root', type: 'frame' } },
]

function renderBar(overrides: Partial<React.ComponentProps<typeof SessionBar>> = {}) {
  const props = {
    sessionKey: 's-a',
    sessions: SESSIONS,
    loading: false,
    error: '',
    onSwitch: vi.fn(),
    onNew: vi.fn(),
    onDelete: vi.fn(),
    snapshots: [],
    onSaveSnapshot: vi.fn(),
    onRestoreSnapshot: vi.fn(),
    onDeleteSnapshot: vi.fn(),
    ...overrides,
  }
  render(<SessionBar {...props} />)
  return props
}

describe('SessionBar（缺陷 4）', () => {
  it('显示当前会话标题与 id（列表默认收起）', () => {
    renderBar()
    expect(screen.getByTestId('session-title')).toHaveTextContent('优惠券页会话')
    expect(screen.getByTestId('session-key')).toHaveTextContent('s-a')
    expect(screen.queryByTestId('session-list')).not.toBeInTheDocument()
  })

  it('展开列表：只展示元信息（标题 + 时间），不含消息与 Agent 状态', async () => {
    renderBar()
    await userEvent.click(screen.getByTestId('session-current'))
    const list = screen.getByTestId('session-list')
    expect(within(list).getByTestId('session-item-s-a')).toHaveTextContent('优惠券页会话')
    expect(within(list).getByTestId('session-item-s-b')).toHaveTextContent('登录页会话')
    expect(list.textContent).not.toContain('messages')
    expect(list.textContent).not.toContain('agent_state')
  })

  it('切换会话：点击其他会话触发回调；点当前会话不触发', async () => {
    const props = renderBar()
    await userEvent.click(screen.getByTestId('session-current'))
    await userEvent.click(screen.getByTestId('session-item-s-a'))
    expect(props.onSwitch).not.toHaveBeenCalled()
    await userEvent.click(screen.getByTestId('session-item-s-b'))
    expect(props.onSwitch).toHaveBeenCalledWith('s-b')
  })

  it('新建会话与删除会话：触发对应回调（删除的二次确认由上层负责）', async () => {
    const props = renderBar()
    await userEvent.click(screen.getByTestId('session-new'))
    expect(props.onNew).toHaveBeenCalledTimes(1)
    await userEvent.click(screen.getByTestId('session-current'))
    await userEvent.click(screen.getByTestId('session-delete-s-b'))
    expect(props.onDelete).toHaveBeenCalledWith('s-b')
  })

  it('错误提示可见（会话接口失败不影响继续操作）', () => {
    renderBar({ error: '会话列表加载失败：offline' })
    expect(screen.getByTestId('session-bar-error')).toHaveTextContent('offline')
  })

  it('快照区：保存快照带备注、回退与删除触发回调', async () => {
    const props = renderBar({ snapshots: SNAPSHOTS })
    await userEvent.click(screen.getByTestId('session-snapshots-toggle'))
    expect(screen.getByTestId('snapshot-list')).toHaveTextContent('初稿')

    await userEvent.type(screen.getByTestId('snapshot-label'), '改配色前')
    await userEvent.click(screen.getByTestId('snapshot-save'))
    expect(props.onSaveSnapshot).toHaveBeenCalledWith('改配色前')

    await userEvent.click(screen.getByTestId('snapshot-restore-snap-1'))
    expect(props.onRestoreSnapshot).toHaveBeenCalledWith('snap-1')
    await userEvent.click(screen.getByTestId('snapshot-delete-snap-1'))
    expect(props.onDeleteSnapshot).toHaveBeenCalledWith('snap-1')
  })

  it('无快照时给出空态与上限说明（不留空白区）', async () => {
    renderBar()
    await userEvent.click(screen.getByTestId('session-snapshots-toggle'))
    expect(screen.getByTestId('snapshot-list')).toHaveTextContent('还没有快照（上限 10 条）')
  })
})
