/**
 * T46a-4：稿件移动 UI（"我的项目"里把稿件移到其他工作区）。
 * 只有存在"别的可写工作区"时才出现入口——不能把自己移到自己。
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

import ProjectsPage from './ProjectsPage'

const DESIGN = { id: 7, name: '登录页', updated_at: '2026-09-16T10:00:00Z', workspace_id: 1 }

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
})
