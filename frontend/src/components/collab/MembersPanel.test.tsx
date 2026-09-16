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
    if (path.includes('/invites/by-username')) {
      // 必须在通用 /invites 之前判：否则会返回"链接"形状的响应
      const body = JSON.parse(String(options?.body ?? '{}'))
      return { ok: true, status: 200, json: async () => ({ ok: true, username: body.username, role: body.role }) }
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

  it('editor（带工作区选择器）：可邀请但只能邀 viewer；移除成员仍禁用', async () => {
    // 工作区列表里只有"我是 editor"的那个 → 不是 owner
    vi.stubGlobal('fetch', mockFetch({ workspaces: [WORKSPACES[1]] }))
    render(<MembersPanel />)

    expect(await screen.findByTestId('member-row-demo')).toBeInTheDocument()
    expect(screen.getByTestId('invite-create')).toBeEnabled()
    expect(screen.getByTestId('invite-role-cap')).toBeInTheDocument()
    expect(screen.getByTestId('invite-role')).toHaveValue('viewer')
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

  it('T46a-4：按用户名直接邀请（后端 409/404 原样显示）', async () => {
    const fetchMock = mockFetch()
    vi.stubGlobal('fetch', fetchMock)
    render(<MembersPanel />)

    const input = await screen.findByTestId('invite-username')
    fireEvent.change(input, { target: { value: 'guest' } })
    fireEvent.click(screen.getByTestId('invite-username-submit'))

    await waitFor(() => {
      const call = fetchMock.mock.calls.find((c) => String(c[0]).includes('/invites/by-username'))
      expect(call).toBeTruthy()
      expect(String(call?.[1]?.body)).toContain('"username":"guest"')
    })
    expect(await screen.findByTestId('members-msg')).toHaveTextContent('guest')
  })

  it('T46a-4：固定工作区模式隐藏选择器；editor 可邀但只能邀 viewer', async () => {
    // 固定到"我是 editor"的工作区
    vi.stubGlobal('fetch', mockFetch({ workspaces: [WORKSPACES[1]] }))
    render(<MembersPanel fixedWorkspaceId={9} onClose={() => {}} />)

    expect(await screen.findByTestId('member-row-demo')).toBeInTheDocument()
    expect(screen.queryByTestId('members-workspace-select')).not.toBeInTheDocument()
    expect(screen.getByTestId('members-close')).toBeInTheDocument()

    // 2026-09-16：editor 可以邀请，但角色选择只有"只读访客"，并给出说明
    expect(screen.getByTestId('invite-role-cap')).toHaveTextContent('只能邀请')
    const roleSelect = screen.getByTestId('invite-role')
    expect(Array.from(roleSelect.querySelectorAll('option')).map((o) => o.getAttribute('value'))).toEqual(['viewer'])
    expect(roleSelect).toHaveValue('viewer')
    // 移除成员仍仅 owner
    expect(screen.getByTestId('member-remove-guest')).toBeDisabled()

    // 输入用户名后"直接邀请"可用（不再是 owner-only）
    fireEvent.change(screen.getByTestId('invite-username'), { target: { value: 'newbie' } })
    expect(screen.getByTestId('invite-username-submit')).toBeEnabled()
  })

  it('T46a-4：viewer 视角不能邀请（按钮禁用）', async () => {
    vi.stubGlobal('fetch', mockFetch({ workspaces: [{ ...WORKSPACES[1], role: 'viewer' }] }))
    render(<MembersPanel />)

    expect(await screen.findByTestId('member-row-demo')).toBeInTheDocument()
    expect(screen.getByTestId('invite-create')).toBeDisabled()
    expect(screen.getByTestId('invite-create')).toHaveAttribute('title', '只有 owner / editor 可以生成邀请')
    // 输入框也禁用（不能"能打字但没后果"），并说明为什么入口仍然可点
    expect(screen.getByTestId('invite-username')).toBeDisabled()
    expect(screen.getByTestId('invite-viewer-note')).toHaveTextContent('可以查看成员')
  })
})
