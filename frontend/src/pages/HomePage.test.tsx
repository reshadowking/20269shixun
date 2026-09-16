/**
 * 缺陷 2 回归：「最近的设计」默认最多 8 条 + 查看更多/收起 + 加载/空/失败三态。
 * fetch 按 URL mock：/api/designs 支持 limit/offset/total（与后端分页语义一致）。
 */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import HomePage from './HomePage'

interface Meta {
  id: number
  name: string
  updated_at: string | null
  node_count: number
  width: number
  height: number
  workspace_name?: string | null
  my_role?: string | null
}

function makeDesigns(n: number): Meta[] {
  return Array.from({ length: n }, (_, i) => ({
    id: i + 1,
    name: `设计 ${i + 1}`,
    updated_at: '2026-09-10T10:00:00',
    node_count: 2,
    width: 800,
    height: 600,
  }))
}

/** 模拟后端 /api/designs?limit&offset（total 为全量条数） */
function serveDesigns(designs: Meta[]) {
  const calls: string[] = []
  const fetchMock = vi.fn(async (url: string, options?: RequestInit) => {
    const u = new URL(String(url), 'http://localhost')
    calls.push(`${u.pathname}${u.search}`)
    if (options?.method === 'DELETE') {
      const id = Number(u.pathname.split('/').pop())
      const index = designs.findIndex((d) => d.id === id)
      if (index >= 0) designs.splice(index, 1)
      return { ok: true, status: 200, json: async () => ({ ok: true }) }
    }
    if (u.pathname === '/api/designs') {
      const limit = u.searchParams.get('limit')
      const offset = Number(u.searchParams.get('offset') ?? 0)
      const rest = designs.slice(offset)
      const page = limit === null ? rest : rest.slice(0, Number(limit))
      return { ok: true, status: 200, json: async () => ({ designs: page, total: designs.length }) }
    }
    if (u.pathname === '/api/generate/templates') {
      return { ok: true, status: 200, json: async () => ({ templates: [{ key: 'login', name: '登录页' }] }) }
    }
    throw new Error(`unexpected fetch: ${url}`)
  })
  return { fetchMock, calls }
}

/** 只匹配卡片按钮（home-design-{数字}），不含删除按钮/容器 */
function cards() {
  return screen.queryAllByTestId(/^home-design-\d+$/)
}

function renderHome() {
  return render(
    <MemoryRouter>
      <HomePage />
    </MemoryRouter>,
  )
}

describe('HomePage 最近设计分页（缺陷 2）', () => {
  beforeEach(() => {
    localStorage.clear()
    localStorage.setItem('design-tool-user', 'demo')
    localStorage.setItem('design-tool-token', 't')
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    localStorage.clear()
  })

  it('0 条：空数据态，无「查看更多」', async () => {
    vi.stubGlobal('fetch', serveDesigns([]).fetchMock)
    renderHome()
    expect(await screen.findByTestId('home-empty')).toBeInTheDocument()
    expect(screen.queryByTestId('home-load-more')).not.toBeInTheDocument()
    expect(screen.queryByTestId('home-designs')).not.toBeInTheDocument()
  })

  it('1 条：全部展示，无「查看更多」', async () => {
    vi.stubGlobal('fetch', serveDesigns(makeDesigns(1)).fetchMock)
    renderHome()
    await waitFor(() => expect(cards()).toHaveLength(1))
    expect(screen.queryByTestId('home-load-more')).not.toBeInTheDocument()
    expect(screen.queryByTestId('home-collapse')).not.toBeInTheDocument()
  })

  it('8 条：全部展示，无「查看更多」（不允许空按钮/禁用占位）', async () => {
    vi.stubGlobal('fetch', serveDesigns(makeDesigns(8)).fetchMock)
    renderHome()
    await waitFor(() => expect(cards()).toHaveLength(8))
    expect(screen.queryByTestId('home-load-more')).not.toBeInTheDocument()
    expect(screen.queryByTestId('home-collapse')).not.toBeInTheDocument()
  })

  it('9 条：默认 8 条 → 查看更多加载剩余 → 收起回 8 条', async () => {
    const { fetchMock, calls } = serveDesigns(makeDesigns(9))
    vi.stubGlobal('fetch', fetchMock)
    renderHome()

    await waitFor(() => expect(cards()).toHaveLength(8))
    expect(screen.getByTestId('home-load-more')).toBeInTheDocument()
    // T36：首屏仍只取 8 条，但追加 with_preview=true（用于缩略图渲染）
    expect(calls[0]).toBe('/api/designs?limit=8&offset=0&with_preview=true')

    await userEvent.click(screen.getByTestId('home-load-more'))
    await waitFor(() => expect(cards()).toHaveLength(9)) // 剩余 1 条已加载并展开
    expect(calls.some((c) => c.startsWith('/api/designs?limit=') && c.includes('offset=8'))).toBe(true)

    await userEvent.click(screen.getByTestId('home-collapse'))
    await waitFor(() => expect(cards()).toHaveLength(8)) // 收起回 8 条
    expect(screen.getByTestId('home-load-more')).toBeInTheDocument()

    // 已加载过的数据再次展开不再重复请求
    const before = calls.length
    await userEvent.click(screen.getByTestId('home-load-more'))
    await waitFor(() => expect(cards()).toHaveLength(9))
    expect(calls.length).toBe(before)
  })

  it('100 条：默认 8 条 → 查看更多一次加载全部剩余 → 收起', async () => {
    const { fetchMock, calls } = serveDesigns(makeDesigns(100))
    vi.stubGlobal('fetch', fetchMock)
    renderHome()

    await waitFor(() => expect(cards()).toHaveLength(8))
    await userEvent.click(screen.getByTestId('home-load-more'))
    await waitFor(() => expect(cards()).toHaveLength(100))
    expect(screen.getByTestId('home-collapse')).toBeInTheDocument()
    expect(calls.filter((c) => c.startsWith('/api/designs')).length).toBeGreaterThanOrEqual(2)

    await userEvent.click(screen.getByTestId('home-collapse'))
    await waitFor(() => expect(cards()).toHaveLength(8))
  })

  it('初始加载中：展示加载态而非空数据态', async () => {
    let resolveFetch: ((v: unknown) => void) | undefined
    const pending = new Promise((resolve) => {
      resolveFetch = resolve
    })
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).startsWith('/api/designs')) {
        await pending
        return { ok: true, status: 200, json: async () => ({ designs: makeDesigns(3), total: 3 }) }
      }
      return { ok: true, status: 200, json: async () => ({ templates: [] }) }
    })
    vi.stubGlobal('fetch', fetchMock)
    renderHome()

    expect(await screen.findByTestId('home-designs-loading')).toBeInTheDocument()
    expect(screen.queryByTestId('home-empty')).not.toBeInTheDocument()

    resolveFetch?.(null)
    await waitFor(() => expect(cards()).toHaveLength(3))
    expect(screen.queryByTestId('home-designs-loading')).not.toBeInTheDocument()
  })

  it('加载失败：展示失败态与重试，重试成功恢复列表（不冒充空数据）', async () => {
    let fail = true
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).startsWith('/api/designs')) {
        if (fail) throw new Error('网络错误')
        return { ok: true, status: 200, json: async () => ({ designs: makeDesigns(9), total: 9 }) }
      }
      return { ok: true, status: 200, json: async () => ({ templates: [] }) }
    })
    vi.stubGlobal('fetch', fetchMock)
    renderHome()

    expect(await screen.findByTestId('home-designs-error')).toBeInTheDocument()
    expect(screen.queryByTestId('home-empty')).not.toBeInTheDocument()

    fail = false
    await userEvent.click(screen.getByTestId('home-designs-retry'))
    await waitFor(() => expect(cards()).toHaveLength(8))
    expect(screen.queryByTestId('home-designs-error')).not.toBeInTheDocument()
  })

  it('展开失败：已展示的 8 条不被破坏，提示可重试且重试后展开成功', async () => {
    const designs = makeDesigns(9)
    let failMore = true
    const fetchMock = vi.fn(async (url: string) => {
      const u = new URL(String(url), 'http://localhost')
      if (u.pathname === '/api/designs') {
        const offset = Number(u.searchParams.get('offset') ?? 0)
        if (offset > 0 && failMore) throw new Error('分页请求失败')
        const limit = u.searchParams.get('limit')
        const rest = designs.slice(offset)
        const page = limit === null ? rest : rest.slice(0, Number(limit))
        return { ok: true, status: 200, json: async () => ({ designs: page, total: designs.length }) }
      }
      return { ok: true, status: 200, json: async () => ({ templates: [] }) }
    })
    vi.stubGlobal('fetch', fetchMock)
    renderHome()

    await waitFor(() => expect(cards()).toHaveLength(8))
    await userEvent.click(screen.getByTestId('home-load-more'))

    // 失败：原 8 条仍在，出现失败提示，按钮回到可重试状态
    expect(await screen.findByTestId('home-designs-more-error')).toBeInTheDocument()
    expect(cards()).toHaveLength(8)
    expect(screen.getByTestId('home-load-more')).toBeEnabled()

    failMore = false
    await userEvent.click(screen.getByTestId('home-load-more'))
    await waitFor(() => expect(cards()).toHaveLength(9))
    expect(screen.queryByTestId('home-designs-more-error')).not.toBeInTheDocument()
  })

  it('展开状态下删除：列表与按钮状态保持一致（总数回到 8 时按钮消失）', async () => {
    vi.stubGlobal('fetch', serveDesigns(makeDesigns(9)).fetchMock)
    vi.stubGlobal('confirm', vi.fn(() => true))
    renderHome()

    await waitFor(() => expect(cards()).toHaveLength(8))
    await userEvent.click(screen.getByTestId('home-load-more'))
    await waitFor(() => expect(cards()).toHaveLength(9))

    await userEvent.click(screen.getByTestId('home-design-delete-1'))
    await waitFor(() => expect(cards()).toHaveLength(8))
    expect(screen.queryByTestId('home-collapse')).not.toBeInTheDocument()
    expect(screen.queryByTestId('home-load-more')).not.toBeInTheDocument()
  })

  it('折叠状态下删除：剩余记录补位到 8 条，不出现「有记录却无入口」', async () => {
    vi.stubGlobal('fetch', serveDesigns(makeDesigns(9)).fetchMock)
    vi.stubGlobal('confirm', vi.fn(() => true))
    renderHome()

    await waitFor(() => expect(cards()).toHaveLength(8))
    await userEvent.click(screen.getByTestId('home-design-delete-1'))
    // 删掉已加载的 1 条后，第 9 条应补位显示（仍为 8 条），总数 8 → 按钮消失
    await waitFor(() => expect(cards()).toHaveLength(8))
    await waitFor(() => expect(screen.queryByTestId('home-load-more')).not.toBeInTheDocument())
  })

  it('共享给我的稿件：卡片标工作区与角色，viewer 不给删除入口', async () => {
    const shared: Meta[] = [
      { ...makeDesigns(1)[0], workspace_name: '别人的工作区', my_role: 'viewer' },
    ]
    vi.stubGlobal('fetch', serveDesigns(shared).fetchMock)
    renderHome()

    expect(await screen.findByTestId('home-design-1-workspace')).toHaveTextContent('别人的工作区')
    expect(screen.getByTestId('home-design-1-role')).toHaveTextContent('只读')
    expect(screen.queryByTestId('home-design-delete-1')).not.toBeInTheDocument()
  })
})
