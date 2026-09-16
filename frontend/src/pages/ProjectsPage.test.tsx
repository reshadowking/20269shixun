/**
 * T46a-4：稿件移动 UI（"我的项目"里把稿件移到其他工作区）。
 * 只有存在"别的可写工作区"时才出现入口——不能把自己移到自己。
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

import ProjectsPage from './ProjectsPage'

const DESIGN = {
  id: 7,
  name: '登录页',
  updated_at: '2026-09-16T10:00:00Z',
  workspace_id: 1,
  workspace_name: '我的工作区',
  my_role: 'owner',
  owner_name: 'demo',
  is_mine: true,
}

function mockFetch(opts: { workspaces: unknown[] }) {
  return vi.fn(async (url: string, options?: RequestInit) => {
    const path = String(url)
    if (path.includes('/api/workspaces')) {
      return { ok: true, status: 200, json: async () => ({ workspaces: opts.workspaces }) }
    }
    if (path.includes('/api/designs/') && options?.method === 'POST') {
      return { ok: true, status: 200, json: async () => ({ ...DESIGN, workspace_id: 2 }) }
    }
    return { ok: true, status: 200, json: async () => ({ designs: [DESIGN], total: 1 }) }
  })
}

function renderPage() {
  return render(
    <MemoryRouter>
      <ProjectsPage />
    </MemoryRouter>,
  )
}

describe('ProjectsPage（T46a-4 移动稿件）', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    localStorage.clear()
  })

  it('列出其他可写工作区，确认后调用 move 接口', async () => {
    const fetchMock = mockFetch({
      workspaces: [
        { id: 1, name: '我的工作区', role: 'owner' },
        { id: 2, name: '团队工作区', role: 'editor' },
        { id: 3, name: '只读工作区', role: 'viewer' },
      ],
    })
    vi.stubGlobal('fetch', fetchMock)
    const confirm = vi.fn((_msg?: string) => true)
    vi.stubGlobal('confirm', confirm)
    renderPage()

    const select = await screen.findByTestId('project-move-7')
    const options = Array.from(select.querySelectorAll('option')).map((o) => o.textContent)
    expect(options).toEqual(['移动到…', '团队工作区']) // 排除当前工作区与 viewer 角色

    fireEvent.change(select, { target: { value: '2' } })
    await waitFor(() => {
      const call = fetchMock.mock.calls.find((c) => String(c[0]) === '/api/designs/7/move')
      expect(call).toBeTruthy()
      expect(call?.[1]?.method).toBe('POST')
      expect(String(call?.[1]?.body)).toContain('"workspace_id":2')
    })
    expect(String(confirm.mock.calls[0][0])).toContain('团队工作区')
  })

  it('只有自己的个人工作区时不显示移动入口', async () => {
    vi.stubGlobal('fetch', mockFetch({ workspaces: [{ id: 1, name: '我的工作区', role: 'owner' }] }))
    renderPage()

    expect(await screen.findByTestId('project-card-7')).toBeInTheDocument()
    expect(screen.queryByTestId('project-move-7')).not.toBeInTheDocument()
  })

  it('卡片标出所属工作区与我的角色（别人共享给我的稿件认得出）', async () => {
    vi.stubGlobal('fetch', mockFetch({ workspaces: [{ id: 1, name: '我的工作区', role: 'owner' }] }))
    renderPage()

    expect(await screen.findByTestId('project-7-workspace')).toHaveTextContent('我的工作区')
    expect(screen.getByTestId('project-7-role')).toHaveTextContent('所有者')
    // 自己的稿件不显示"由 X 共享"
    expect(screen.queryByTestId('project-7-shared-by')).not.toBeInTheDocument()
  })

  it('别人共享给我的稿件：显示「由 X 共享」', async () => {
    const shared = { ...DESIGN, workspace_id: 2, workspace_name: 'peer 的工作区', my_role: 'editor', owner_name: 'peer', is_mine: false }
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (String(url).includes('/api/workspaces')) {
          return { ok: true, status: 200, json: async () => ({ workspaces: [{ id: 1, name: '我的工作区', role: 'owner' }] }) }
        }
        return { ok: true, status: 200, json: async () => ({ designs: [shared], total: 1 }) }
      }),
    )
    renderPage()

    expect(await screen.findByTestId('project-7-shared-by')).toHaveTextContent('由 peer 共享')
  })

  it('viewer 行：角色标"只读"、删除禁用、不给移动入口', async () => {
    const viewerDesign = { ...DESIGN, workspace_id: 2, workspace_name: '别人的工作区', my_role: 'viewer' }
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const path = String(url)
        if (path.includes('/api/workspaces')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              workspaces: [
                { id: 2, name: '别人的工作区', role: 'editor' }, // 我有别的可写工作区……
                { id: 1, name: '我的工作区', role: 'owner' },
              ],
            }),
          }
        }
        return { ok: true, status: 200, json: async () => ({ designs: [viewerDesign], total: 1 }) }
      }),
    )
    renderPage()

    expect(await screen.findByTestId('project-7-role')).toHaveTextContent('只读')
    expect(screen.getByTestId('project-delete-7')).toBeDisabled()
    // 稿件本身是只读（viewer）→ 即使我有别的可写工作区，也不给移动入口
    expect(screen.queryByTestId('project-move-7')).not.toBeInTheDocument()
  })
})
