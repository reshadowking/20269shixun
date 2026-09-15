/**
 * T46a-4：「成员与邀请」面板。
 * 关键行为：owner 能生成**一次性**邀请链接并移除成员；非 owner 的按钮禁用且说明原因
 * （不让人点了才发现不行）。
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import MembersPanel from './MembersPanel'

const WORKSPACES = [
  { id: 3, name: '我的工作区', owner_id: 1, role: 'owner' },
  { id: 9, name: '别人的工作区', owner_id: 2, role: 'editor' },
]

const MEMBERS = [
  { user_id: 1, username: 'demo', role: 'owner' },
  { user_id: 2, username: 'guest', role: 'viewer' },
]

function mockFetch(overrides: { workspaces?: unknown[] } = {}) {
  return vi.fn(async (url: string, options?: RequestInit) => {
    const path = String(url)
    const method = options?.method ?? 'GET'
    if (path.endsWith('/api/workspaces')) {
      return { ok: true, status: 200, json: async () => ({ workspaces: overrides.workspaces ?? WORKSPACES }) }
    }
    if (path.includes('/members/')) {
      return { ok: true, status: 200, json: async () => ({ ok: true }) }
    }
    if (path.includes('/members')) {
      return { ok: true, status: 200, json: async () => ({ members: MEMBERS }) }
    }
    if (path.includes('/invites')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ token: 'tok-invite-123', role: 'viewer', join_path: '/join?token=tok-invite-123' }),
      }
    }
    throw new Error(`unexpected fetch: ${method} ${path}`)
  })
}

describe('T46a-4：成员与邀请面板', () => {
  beforeEach(() => {
    localStorage.clear()
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn(async () => undefined) },
    })
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    localStorage.clear()
  })

  it('列出成员与角色；owner 生成邀请链接得到可复制的绝对地址', async () => {
    vi.stubGlobal('fetch', mockFetch())
    render(<MembersPanel />)

    expect(await screen.findByTestId('member-row-demo')).toBeInTheDocument()
    expect(screen.getByTestId('member-role-guest')).toHaveTextContent('只读访客')
    // 默认选中"我的工作区"（role=owner）
    expect(screen.getByTestId('members-workspace-select')).toHaveValue('3')

    fireEvent.change(screen.getByTestId('invite-role'), { target: { value: 'viewer' } })
    fireEvent.click(screen.getByTestId('invite-create'))

    const link = await screen.findByTestId('invite-link')
    expect(link).toHaveValue(`${window.location.origin}/join?token=tok-invite-123`)

    fireEvent.click(screen.getByTestId('invite-copy'))
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith(link.getAttribute('value')))
    expect(screen.getByTestId('members-msg')).toHaveTextContent('已复制')
  })

  it('非 owner（editor）：生成邀请与移除都禁用，并说明原因', async () => {
    // 工作区列表里只有"我是 editor"的那个 → 不是 owner
    vi.stubGlobal('fetch', mockFetch({ workspaces: [WORKSPACES[1]] }))
    render(<MembersPanel />)

    expect(await screen.findByTestId('member-row-demo')).toBeInTheDocument()
    expect(screen.getByTestId('invite-create')).toBeDisabled()
    expect(screen.getByTestId('invite-create')).toHaveAttribute('title', '只有工作区所有者可以生成邀请')
    expect(screen.getByTestId('member-remove-guest')).toBeDisabled()
  })

  it('owner 移除成员：确认后 DELETE，并刷新列表', async () => {
    const fetchMock = mockFetch()
    vi.stubGlobal('fetch', fetchMock)
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<MembersPanel />)

    const removeBtn = await screen.findByTestId('member-remove-guest')
    // owner 自己那一行不可移除
    expect(screen.getByTestId('member-remove-demo')).toBeDisabled()
    fireEvent.click(removeBtn)

    await waitFor(() =>
      expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('/api/workspaces/3/members/2') && c[1]?.method === 'DELETE')).toBe(true),
    )
    expect(screen.getByTestId('members-msg')).toHaveTextContent('已移除 guest')
  })
})
