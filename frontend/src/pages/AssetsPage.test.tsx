/** T38：「我的资产」页——列表/配额展示、空态、删除调用、上传走 multipart。 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

import AssetsPage from './AssetsPage'
import { readAssetView, writeAssetView } from '@/lib/assetView'

const IMAGE = {
  id: 7,
  filename: 'hero.png',
  url: '/api/images/7',
  public_url: '/api/images/7?k=abc123abc123ab',
  visibility: 'private',
  referenced_by: 0,
  size: 2048,
  created_at: '2026-09-15T10:00:00Z',
}

function mockFetch(list: unknown, opts: { deleteStatus?: number; folders?: unknown; ungrouped?: number } = {}) {
  return vi.fn(async (url: string, options?: RequestInit) => {
    const path = String(url)
    if (path.includes('/api/asset-folders')) {
      if (options?.method === 'POST') return { ok: true, status: 200, json: async () => ({ id: 3, name: '新目录', count: 0 }) }
      if (options?.method === 'DELETE') return { ok: true, status: 200, json: async () => ({ ok: true, moved_to_ungrouped: 1 }) }
      if (options?.method === 'PATCH') return { ok: true, status: 200, json: async () => ({ id: 1, name: '改名后' }) }
      return {
        ok: true,
        status: 200,
        json: async () => ({ folders: opts.folders ?? [], ungrouped: opts.ungrouped ?? 0, limit_folders: 30 }),
      }
    }
    if (options?.method === 'DELETE') {
      return { ok: (opts.deleteStatus ?? 200) === 200, status: opts.deleteStatus ?? 200, json: async () => ({ ok: true }) }
    }
    if (options?.method === 'POST') {
      return { ok: true, status: 200, json: async () => ({ id: 8, url: '/api/images/8' }) }
    }
    if (options?.method === 'PATCH') {
      const body = JSON.parse(String(options.body ?? '{}'))
      return { ok: true, status: 200, json: async () => ({ ...IMAGE, visibility: body.visibility }) }
    }
    return { ok: true, status: 200, json: async () => list }
  })
}

function renderPage() {
  return render(
    <MemoryRouter>
      <AssetsPage />
    </MemoryRouter>,
  )
}

describe('AssetsPage（T38）', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    localStorage.clear()
  })

  it('展示资产列表与用量配额', async () => {
    vi.stubGlobal('fetch', mockFetch({ images: [IMAGE], used_bytes: 2048, limit_count: 50, limit_bytes: 20971520 }))
    renderPage()
    expect(await screen.findByTestId('asset-card-7')).toBeInTheDocument()
    expect(screen.getByTestId('assets-usage')).toHaveTextContent('1/50 张')
    expect(screen.getByTestId('assets-usage')).toHaveTextContent('2.0 KB')
    expect(screen.queryByTestId('assets-empty')).toBeNull()
  })

  it('没有资产时显示空态引导', async () => {
    vi.stubGlobal('fetch', mockFetch({ images: [], used_bytes: 0, limit_count: 50, limit_bytes: 20971520 }))
    renderPage()
    expect(await screen.findByTestId('assets-empty')).toBeInTheDocument()
  })

  it('删除走 DELETE 并刷新列表', async () => {
    const fetchMock = mockFetch({ images: [IMAGE], used_bytes: 2048, limit_count: 50, limit_bytes: 20971520 })
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('confirm', () => true)
    renderPage()
    fireEvent.click(await screen.findByTestId('asset-delete-7'))
    await waitFor(() => {
      expect(fetchMock.mock.calls.some((c) => String(c[0]) === '/api/images/7' && c[1]?.method === 'DELETE')).toBe(true)
    })
  })

  it('上传走 multipart（FormData）且不手动设置 Content-Type', async () => {
    const fetchMock = mockFetch({ images: [], used_bytes: 0, limit_count: 50, limit_bytes: 20971520 })
    vi.stubGlobal('fetch', fetchMock)
    renderPage()
    const input = (await screen.findByTestId('asset-input')) as HTMLInputElement
    const file = new File([new Uint8Array([1, 2, 3])], 'a.png', { type: 'image/png' })
    fireEvent.change(input, { target: { files: [file] } })
    await waitFor(() => {
      const call = fetchMock.mock.calls.find((c) => c[1]?.method === 'POST')
      expect(call).toBeTruthy()
      expect(call?.[1]?.body).toBeInstanceOf(FormData)
      expect((call?.[1]?.headers as Record<string, string> | undefined)?.['Content-Type']).toBeUndefined()
    })
  })
})

describe('AssetsPage（T46b 可见性）', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    localStorage.clear()
  })

  it('展示可见性选择与被引用次数', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch({
        images: [{ ...IMAGE, referenced_by: 2 }],
        used_bytes: 2048,
        limit_count: 50,
        limit_bytes: 20971520,
      }),
    )
    renderPage()

    expect(await screen.findByTestId('asset-visibility-7')).toHaveValue('private')
    expect(screen.getByTestId('asset-refs-7')).toHaveTextContent('被 2 份稿件引用')
  })

  it('切换可见性走 PATCH 并刷新', async () => {
    const fetchMock = mockFetch({ images: [IMAGE], used_bytes: 2048, limit_count: 50, limit_bytes: 20971520 })
    vi.stubGlobal('fetch', fetchMock)
    renderPage()

    fireEvent.change(await screen.findByTestId('asset-visibility-7'), { target: { value: 'workspace' } })

    await waitFor(() => {
      const call = fetchMock.mock.calls.find((c) => String(c[0]) === '/api/images/7/visibility')
      expect(call).toBeTruthy()
      expect(call?.[1]?.method).toBe('PATCH')
      expect(String(call?.[1]?.body)).toContain('"workspace"')
    })
  })

  it('public-link 时复制的是带凭证的公开链接', async () => {
    const writeText = vi.fn(async (_text: string) => undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    vi.stubGlobal(
      'fetch',
      mockFetch({
        images: [{ ...IMAGE, visibility: 'public-link' }],
        used_bytes: 2048,
        limit_count: 50,
        limit_bytes: 20971520,
      }),
    )
    renderPage()

    fireEvent.click(await screen.findByTestId('asset-copy-7'))
    await waitFor(() => expect(writeText).toHaveBeenCalled())
    expect(String(writeText.mock.calls[0][0])).toContain('/api/images/7?k=abc123abc123ab')
  })
})

describe('AssetsPage（T44 文件夹）', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    localStorage.clear()
  })

  const FOLDERS = [
    { id: 1, name: '图标', count: 2 },
    { id: 2, name: '背景', count: 1 },
  ]

  it('文件夹栏显示计数，切换范围后按 folder_id 过滤', async () => {
    const fetchMock = mockFetch(
      { images: [{ ...IMAGE, folder_id: 1 }], used_bytes: 2048, limit_count: 50, limit_bytes: 20971520 },
      { folders: FOLDERS, ungrouped: 3 },
    )
    vi.stubGlobal('fetch', fetchMock)
    renderPage()

    expect(await screen.findByTestId('folder-1')).toHaveTextContent('图标')
    expect(screen.getByTestId('folder-count-1')).toHaveTextContent('2')
    expect(screen.getByTestId('folder-count-none')).toHaveTextContent('3')
    expect(screen.getByTestId('folder-count-all')).toHaveTextContent('6') // 2 + 1 + 3

    fireEvent.click(screen.getByTestId('folder-2'))
    await waitFor(() =>
      expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('/api/images?folder_id=2'))).toBe(true),
    )
    fireEvent.click(screen.getByTestId('folder-none'))
    await waitFor(() =>
      expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('/api/images?folder_id=none'))).toBe(true),
    )
  })

  it('卡片上的文件夹下拉把资产移进去（PATCH /folder）', async () => {
    const fetchMock = mockFetch(
      { images: [{ ...IMAGE, folder_id: null }], used_bytes: 2048, limit_count: 50, limit_bytes: 20971520 },
      { folders: FOLDERS },
    )
    vi.stubGlobal('fetch', fetchMock)
    renderPage()

    const select = await screen.findByTestId('asset-folder-7')
    expect(select).toHaveValue('')
    fireEvent.change(select, { target: { value: '2' } })

    await waitFor(() => {
      const call = fetchMock.mock.calls.find((c) => String(c[0]) === '/api/images/7/folder')
      expect(call).toBeTruthy()
      expect(call?.[1]?.method).toBe('PATCH')
      expect(String(call?.[1]?.body)).toContain('"folder_id":2')
    })
  })

  it('新建文件夹取 prompt 的名字并创建', async () => {
    const fetchMock = mockFetch(
      { images: [], used_bytes: 0, limit_count: 50, limit_bytes: 20971520 },
      { folders: [] },
    )
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('prompt', () => '新目录')
    renderPage()

    fireEvent.click(await screen.findByTestId('folder-create'))
    await waitFor(() => {
      const call = fetchMock.mock.calls.find((c) => String(c[0]) === '/api/asset-folders' && c[1]?.method === 'POST')
      expect(call).toBeTruthy()
      expect(String(call?.[1]?.body)).toContain('新目录')
    })
  })

  it('删除文件夹要二次确认，并说明内容会上提一层（不删东西）', async () => {
    const fetchMock = mockFetch(
      { images: [], used_bytes: 0, limit_count: 50, limit_bytes: 20971520 },
      { folders: FOLDERS },
    )
    vi.stubGlobal('fetch', fetchMock)
    const confirm = vi.fn((_message?: string) => true)
    vi.stubGlobal('confirm', confirm)
    renderPage()

    fireEvent.click(await screen.findByTestId('folder-delete-1'))
    await waitFor(() => {
      expect(fetchMock.mock.calls.some((c) => String(c[0]) === '/api/asset-folders/1' && c[1]?.method === 'DELETE')).toBe(true)
    })
    expect(String(confirm.mock.calls[0][0])).toContain('上提一层')
  })
})

describe('AssetsPage（T45 展示方式）', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    localStorage.clear()
  })

  const LIST = { images: [{ ...IMAGE, folder_id: null }], used_bytes: 2048, limit_count: 50, limit_bytes: 20971520 }

  it('默认大图标；切到小图标后写入记忆', async () => {
    vi.stubGlobal('fetch', mockFetch(LIST, { folders: [] }))
    renderPage()

    const container = await screen.findByTestId('asset-view')
    expect(container).toHaveAttribute('data-view', 'large')
    expect(screen.getByTestId('view-large')).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(screen.getByTestId('view-small'))
    await waitFor(() => expect(screen.getByTestId('asset-view')).toHaveAttribute('data-view', 'small'))
    expect(screen.getByTestId('view-small')).toHaveAttribute('aria-pressed', 'true')
    // 存储走 @/lib/storage 适配器（测试里是注入的内存实现），所以用同一个读接口断言
    expect(readAssetView()).toBe('small')
  })

  it('记住选择：下次进入直接是文件信息视图', async () => {
    writeAssetView('details')
    vi.stubGlobal('fetch', mockFetch(LIST, { folders: [] }))
    renderPage()

    expect(await screen.findByTestId('asset-row-7')).toBeInTheDocument()
    expect(screen.queryByTestId('asset-card-7')).not.toBeInTheDocument()
    expect(screen.getByTestId('view-details')).toHaveAttribute('aria-pressed', 'true')
  })

  it('文件信息视图下功能不丢：能删除、能移动文件夹、能看到大小与可见性', async () => {
    writeAssetView('details')
    const fetchMock = mockFetch(LIST, { folders: [{ id: 1, name: '图标', count: 0 }] })
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('confirm', () => true)
    renderPage()

    const row = await screen.findByTestId('asset-row-7')
    expect(row).toHaveTextContent('2.0 KB')
    expect(row).toHaveTextContent('私有')

    fireEvent.change(screen.getByTestId('asset-folder-7'), { target: { value: '1' } })
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some((c) => String(c[0]) === '/api/images/7/folder' && c[1]?.method === 'PATCH'),
      ).toBe(true),
    )
    fireEvent.click(screen.getByTestId('asset-delete-7'))
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some((c) => String(c[0]) === '/api/images/7' && c[1]?.method === 'DELETE'),
      ).toBe(true),
    )
  })
})

describe('AssetsPage（拖拽排序）', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    localStorage.clear()
  })

  const TWO = {
    images: [
      { ...IMAGE, id: 7, folder_id: 1, sort_order: 0 },
      { ...IMAGE, id: 8, filename: 'second.png', folder_id: 1, sort_order: 1 },
    ],
    used_bytes: 4096,
    limit_count: 50,
    limit_bytes: 20971520,
  }

  function mockWithOrder() {
    return vi.fn(async (url: string, options?: RequestInit) => {
      const path = String(url)
      const method = options?.method ?? 'GET'
      if (path.includes('/api/asset-folders')) {
        if (method === 'PATCH') return { ok: true, status: 200, json: async () => ({ ok: true, count: 2 }) }
        return {
          ok: true,
          status: 200,
          json: async () => ({
            folders: [
              { id: 1, name: '图标', count: 2 },
              { id: 2, name: '背景', count: 0 },
            ],
            ungrouped: 0,
            limit_folders: 30,
          }),
        }
      }
      if (method === 'PATCH') return { ok: true, status: 200, json: async () => ({ ok: true, count: 2 }) }
      return { ok: true, status: 200, json: async () => TWO }
    })
  }

  it('文件夹内拖动资产：按落点重排并 PATCH /api/images/order（带 folder_id）', async () => {
    const fetchMock = mockWithOrder()
    vi.stubGlobal('fetch', fetchMock)
    renderPage()

    // 进入文件夹 1（才有排序语义）
    fireEvent.click(await screen.findByTestId('folder-1'))
    const grip = await screen.findByTestId('asset-grip-7')

    fireEvent.dragStart(grip)
    fireEvent.dragOver(screen.getByTestId('asset-card-8'))
    fireEvent.drop(screen.getByTestId('asset-card-8'))

    await waitFor(() => {
      const call = fetchMock.mock.calls.find((c) => String(c[0]) === '/api/images/order')
      expect(call).toBeTruthy()
      expect(call?.[1]?.method).toBe('PATCH')
      const body = JSON.parse(String(call?.[1]?.body))
      expect(body.ids).toEqual([8, 7]) // 7 拖到 8 之后 → 8 在前
      expect(body.folder_id).toBe(1)
    })
  })

  it('"全部素材"视图不给拖拽入口，并说明原因', async () => {
    vi.stubGlobal('fetch', mockWithOrder())
    renderPage()

    expect(await screen.findByTestId('asset-card-7')).toBeInTheDocument()
    expect(screen.queryByTestId('asset-grip-7')).not.toBeInTheDocument()
    expect(screen.getByTestId('asset-order-hint')).toHaveTextContent('进入某个文件夹')
  })

  it('侧边栏拖动文件夹：PATCH /api/asset-folders/order', async () => {
    const fetchMock = mockWithOrder()
    vi.stubGlobal('fetch', fetchMock)
    renderPage()

    const grip = await screen.findByTestId('folder-grip-1')
    fireEvent.dragStart(grip)
    fireEvent.dragOver(screen.getByTestId('folder-2'))
    fireEvent.drop(screen.getByTestId('folder-2'))

    await waitFor(() => {
      const call = fetchMock.mock.calls.find((c) => String(c[0]) === '/api/asset-folders/order')
      expect(call).toBeTruthy()
      expect(JSON.parse(String(call?.[1]?.body)).ids).toEqual([2, 1])
    })
  })

  it('多层目录：子目录按层级缩进渲染，父级下拉可选"顶层"与其它目录（排除自己）', async () => {
    const fetchMock = vi.fn(async (url: string, options?: RequestInit) => {
      const path = String(url)
      if (path.includes('/api/asset-folders')) {
        if (options?.method === 'PATCH') return { ok: true, status: 200, json: async () => ({ ok: true }) }
        return {
          ok: true,
          status: 200,
          json: async () => ({
            folders: [
              { id: 1, name: '素材', count: 0, parent_id: null },
              { id: 2, name: '图标', count: 0, parent_id: 1 },
            ],
            ungrouped: 0,
            limit_folders: 30,
          }),
        }
      }
      return { ok: true, status: 200, json: async () => ({ images: [], used_bytes: 0, limit_count: 50, limit_bytes: 1 }) }
    })
    vi.stubGlobal('fetch', fetchMock)
    renderPage()

    expect(await screen.findByTestId('folder-1')).toHaveAttribute('data-depth', '1')
    expect(screen.getByTestId('folder-2')).toHaveAttribute('data-depth', '2')
    // 子目录的父级下拉：当前是"素材"，候选里有"顶层"，但**没有它自己**
    const parentSelect = screen.getByTestId('folder-parent-2')
    expect(parentSelect).toHaveValue('1')
    const values = Array.from(parentSelect.querySelectorAll('option')).map((o) => o.getAttribute('value'))
    expect(values).toEqual(['', '1'])

    // 改父级 → PATCH /parent
    fireEvent.change(parentSelect, { target: { value: '' } })
    await waitFor(() => {
      const call = fetchMock.mock.calls.find((c) => String(c[0]) === '/api/asset-folders/2/parent')
      expect(call).toBeTruthy()
      expect(String(call?.[1]?.body)).toContain('"parent_id":null')
    })
  })

  it('在选中的文件夹里新建：POST 带 parent_id（子目录）', async () => {
    const fetchMock = vi.fn(async (url: string, options?: RequestInit) => {
      const path = String(url)
      if (path.includes('/api/asset-folders')) {
        if (options?.method === 'POST') return { ok: true, status: 200, json: async () => ({ id: 9, name: '新子目录' }) }
        return {
          ok: true,
          status: 200,
          json: async () => ({
            folders: [{ id: 1, name: '素材', count: 0, parent_id: null }],
            ungrouped: 0,
            limit_folders: 30,
          }),
        }
      }
      return { ok: true, status: 200, json: async () => ({ images: [], used_bytes: 0, limit_count: 50, limit_bytes: 1 }) }
    })
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('prompt', () => '新子目录')
    renderPage()

    // 先进入"素材"，再新建 → 建的应该是它的子目录
    fireEvent.click(await screen.findByTestId('folder-1'))
    fireEvent.click(screen.getByTestId('folder-create'))

    await waitFor(() => {
      const call = fetchMock.mock.calls.find((c) => String(c[0]) === '/api/asset-folders' && c[1]?.method === 'POST')
      expect(call).toBeTruthy()
      const body = JSON.parse(String(call?.[1]?.body))
      expect(body).toEqual({ name: '新子目录', parent_id: 1 })
    })
  })
})

/**
 * 过期响应（2026-09-17）：切换文件夹时，慢的旧响应会把上一个范围的资产贴进当前网格
 * （用户故事：点了文件夹 A 再点 B，网格里却是 A 的图）。
 */
describe('AssetsPage 过期响应', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    localStorage.clear()
  })

  it('切换文件夹时，慢的旧资产响应不能覆盖当前网格', async () => {
    const gate: { resolve?: (v: unknown) => void } = {}
    const pending = new Promise<unknown>((resolve) => {
      gate.resolve = resolve
    })
    const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body })
    const image = (id: number, filename: string) => ({ ...IMAGE, id, filename, url: `/api/images/${id}` })
    let listCalls = 0
    const fetchMock = vi.fn(async (url: string) => {
      const path = String(url)
      if (path.includes('/api/asset-folders')) {
        return ok({
          folders: [
            { id: 1, name: '素材', parent_id: null, count: 1, created_at: null },
            { id: 2, name: '图标', parent_id: null, count: 1, created_at: null },
          ],
          ungrouped: 0,
          limit_folders: 30,
        })
      }
      listCalls += 1
      // 第 1 次（挂载）：立刻返回，让首屏就绪并顺带拉文件夹
      if (listCalls === 1) {
        return ok({ images: [image(11, 'first-load.png')], used_bytes: 10, limit_count: 50, limit_bytes: 100 })
      }
      // 第 2 次（点文件夹 2）：挂着 —— 这是"过期响应"
      if (listCalls === 2) return pending
      // 第 3 次（点文件夹 1）：立刻返回最新结果
      return ok({ images: [image(22, 'latest.png')], used_bytes: 10, limit_count: 50, limit_bytes: 100 })
    })
    vi.stubGlobal('fetch', fetchMock)
    renderPage()

    expect(await screen.findByText('first-load.png')).toBeInTheDocument()
    // 先点文件夹 2（请求挂着），再点文件夹 1（请求立刻返回最新结果）
    fireEvent.click(await screen.findByTestId('folder-2'))
    fireEvent.click(screen.getByTestId('folder-1'))
    expect(await screen.findByText('latest.png')).toBeInTheDocument()

    // 让"过期"的文件夹 2 响应回来：不能覆盖当前网格
    gate.resolve?.(ok({ images: [image(33, 'stale-folder2.png')], used_bytes: 10, limit_count: 50, limit_bytes: 100 }))
    await new Promise((r) => setTimeout(r, 60))
    expect(screen.queryByText('stale-folder2.png')).not.toBeInTheDocument()
    expect(screen.getByText('latest.png')).toBeInTheDocument()
  })
})
