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

  it('删除文件夹要二次确认，并说明图片会回到未分组', async () => {
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
    expect(String(confirm.mock.calls[0][0])).toContain('未分组')
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
