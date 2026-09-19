/**
 * T46a-4 第 2 件：工作台内的邀请入口。
 * 已保存稿件 → 顶栏出现「邀请协作」→ 点开的风幕里是**固定到本稿工作区**的成员面板；
 * 草稿（没有工作区）→ 不出现该入口，避免点开一个空面板。
 */
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { DesignNode } from '@/design/types'

import WorkspacePage from './WorkspacePage'

const SEEDED: DesignNode = {
  id: 'root',
  type: 'frame',
  style: { layout: 'column' },
  children: [{ id: 't1', type: 'text', props: { text: '标题' }, style: {} }],
}

function mockFetch() {
  return vi.fn(async (url: string, options?: RequestInit) => {
    const path = String(url)
    const method = options?.method ?? 'GET'
    if (path.includes('/collab')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ room: 'room-1', role: 'owner', can_edit: true, design_id: 7, workspace_id: 3 }),
      }
    }
    if (/\/api\/designs\/7/.test(path) && method === 'GET') {
      return { ok: true, status: 200, json: async () => ({ id: 7, name: '稿', design: SEEDED }) }
    }
    // 注意顺序：/api/workspaces/{id}/members 也包含 '/api/workspaces'，必须先判 members
    if (path.includes('/members')) {
      return { ok: true, status: 200, json: async () => ({ members: [{ user_id: 1, username: 'demo', role: 'owner' }] }) }
    }
    if (path.includes('/api/workspaces')) {
      return { ok: true, status: 200, json: async () => ({ workspaces: [{ id: 3, name: '我的工作区', owner_id: 1, role: 'owner' }] }) }
    }
    if (path.includes('/api/sessions')) {
      if (path.includes('/beautify-lock')) return { ok: true, status: 200, json: async () => ({ locked: false }) }
      if (path.includes('/messages')) return { ok: true, status: 200, json: async () => ({ messages: [], pruned: 0 }) }
      return {
        ok: true,
        status: 200,
        json: async () => ({ sessions: [], total: 0, session_id: 's-inv', title: 't', design_id: null, agent_state: {} }),
      }
    }
    throw new Error(`unexpected fetch: ${method} ${path}`)
  })
}

function renderAt(entry: string) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <WorkspacePage />
    </MemoryRouter>,
  )
}

describe('T46a-4：工作台邀请入口', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.stubEnv('VITE_WS_URL', '') // 本地模式，不连 WS
    class RO {
      observe = vi.fn()
      unobserve = vi.fn()
      disconnect = vi.fn()
    }
    vi.stubGlobal('ResizeObserver', RO)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    localStorage.clear()
  })

  it('已保存稿件：顶栏出现邀请入口，点开是固定工作区的成员面板', async () => {
    vi.stubGlobal('fetch', mockFetch())
    renderAt('/workspace?design=7')

    fireEvent.click(await screen.findByTestId('invite-collab'))
    expect(await screen.findByTestId('invite-dialog')).toBeInTheDocument()
    expect(screen.getByTestId('members-panel')).toBeInTheDocument()
    // 固定工作区：没有选择器，只有成员列表与邀请控件
    expect(screen.queryByTestId('members-workspace-select')).not.toBeInTheDocument()
    expect(screen.getByTestId('invite-username')).toBeInTheDocument()

    // 关闭按钮收起风幕
    fireEvent.click(screen.getByTestId('members-close'))
    expect(screen.queryByTestId('invite-dialog')).not.toBeInTheDocument()
  })

  it('草稿：没有工作区，不显示邀请入口', async () => {
    vi.stubGlobal('fetch', mockFetch())
    renderAt('/workspace?from=draft&session=s-draft9')

    // 等页面进入加载完成（草稿从本地种子渲染）
    expect(await screen.findByTestId('workspace-page')).toBeInTheDocument()
    expect(screen.queryByTestId('invite-collab')).not.toBeInTheDocument()
  })
})
