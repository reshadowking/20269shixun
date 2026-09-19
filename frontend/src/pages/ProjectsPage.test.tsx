/**
 * T46a-4：稿件移动 UI（"我的项目"里把稿件移到其他工作区）。
 * 只有存在"别的可写工作区"时才出现入口——不能把自己移到自己。
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

import ProjectsPage from './ProjectsPage'
import { readProjectSort, writeProjectSort } from '@/lib/projectSort'

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

describe('ProjectsPage（列表搜索与排序）', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    localStorage.clear()
  })

  it('搜索：输入后带 q 请求（防抖），计数写明匹配词', async () => {
    const fetchMock = mockFetch({ workspaces: [] })
    vi.stubGlobal('fetch', fetchMock)
    renderPage()

    fireEvent.change(await screen.findByTestId('projects-search'), { target: { value: '登录' } })
    await waitFor(
      () => expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('q=%E7%99%BB%E5%BD%95'))).toBe(true),
      { timeout: 2000 },
    )
    expect(screen.getByTestId('projects-count')).toHaveTextContent('匹配「登录」')
  })

  it('无匹配：显示"没有匹配"空态（与"还没有稿件"区分开）并可一键清除', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const path = String(url)
      if (path.includes('/api/workspaces')) {
        return { ok: true, status: 200, json: async () => ({ workspaces: [] }) }
      }
      const hasQuery = path.includes('q=')
      return {
        ok: true,
        status: 200,
        json: async () => (hasQuery ? { designs: [], total: 0 } : { designs: [DESIGN], total: 1 }),
      }
    })
    vi.stubGlobal('fetch', fetchMock)
    renderPage()

    fireEvent.change(await screen.findByTestId('projects-search'), { target: { value: '不存在' } })
    expect(await screen.findByTestId('projects-no-match')).toHaveTextContent('没有匹配')
    expect(screen.queryByTestId('projects-empty')).not.toBeInTheDocument()

    fireEvent.click(screen.getByTestId('projects-no-match-clear'))
    expect(await screen.findByTestId('project-card-7')).toBeInTheDocument()
  })

  it('排序：切换后带 sort 参数请求，并从第一页开始', async () => {
    const fetchMock = mockFetch({ workspaces: [] })
    vi.stubGlobal('fetch', fetchMock)
    renderPage()

    fireEvent.change(await screen.findByTestId('projects-sort'), { target: { value: 'name_asc' } })
    await waitFor(() => expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('sort=name_asc'))).toBe(true))
    const last = String(fetchMock.mock.calls.at(-1)?.[0] ?? '')
    expect(last).toContain('offset=0')
  })

  it('排序方式被记住：预置后首次请求就带上，切换后写回存储', async () => {
    writeProjectSort('name_asc')
    const fetchMock = mockFetch({ workspaces: [] })
    vi.stubGlobal('fetch', fetchMock)
    renderPage()

    // 记忆生效：**第一次**请求就带 sort=name_asc（不是"先默认再纠正"）
    await waitFor(() => expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('sort=name_asc'))).toBe(true))
    const first = String(fetchMock.mock.calls[0][0])
    expect(first).toContain('sort=name_asc')
    expect(screen.getByTestId('projects-sort')).toHaveValue('name_asc')

    fireEvent.change(screen.getByTestId('projects-sort'), { target: { value: 'created_desc' } })
    expect(readProjectSort()).toBe('created_desc')
  })
})

/**
 * 过期响应竞态（2026-09-17）：`load()` 没有请求序号/取消，慢的旧响应会覆盖新结果。
 * 用户故事：搜索词或排序刚改，列表却显示**上一个条件**的结果（得再点一下才刷新）。
 */
describe('ProjectsPage 过期响应', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    localStorage.clear()
  })

  it('慢的旧响应不能覆盖新结果（按条件变化的过期响应必须丢弃）', async () => {
    let designsCalls = 0
    // 用对象挂载 resolve，避免 TS 把闭包里的赋值当成"从未发生"而收窄成 never
    const gate: { resolve?: (v: unknown) => void } = {}
    const firstPending = new Promise<unknown>((resolve) => {
      gate.resolve = resolve
    })
    const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body })
    const row = (name: string) => ({ ...DESIGN, id: 2, name })

    const fetchMock = vi.fn(async (url: string) => {
      const path = String(url)
      if (path.includes('/api/workspaces')) return ok({ workspaces: [] })
      designsCalls += 1
      if (designsCalls === 1) return firstPending // 首个请求：挂着不返回
      return ok({ designs: [row('新结果')], total: 1 })
    })
    vi.stubGlobal('fetch', fetchMock)

    renderPage()
    await waitFor(() => expect(designsCalls).toBe(1))

    // 改搜索词 → 防抖后发第二个请求（立刻返回"新结果"）
    fireEvent.change(screen.getByTestId('projects-search'), { target: { value: '新' } })
    await waitFor(() => expect(screen.getByText('新结果')).toBeInTheDocument(), { timeout: 3000 })
    expect(designsCalls).toBeGreaterThanOrEqual(2)

    // 现在让"过期"的首个响应回来：它不能覆盖已经渲染的新结果
    gate.resolve?.(ok({ designs: [row('旧结果')], total: 1 }))
    await new Promise((r) => setTimeout(r, 60))
    expect(screen.queryByText('旧结果')).not.toBeInTheDocument()
    expect(screen.getByText('新结果')).toBeInTheDocument()
  })
})
