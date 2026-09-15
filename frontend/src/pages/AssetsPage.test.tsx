/** T38：「我的资产」页——列表/配额展示、空态、删除调用、上传走 multipart。 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

import AssetsPage from './AssetsPage'

const IMAGE = { id: 7, filename: 'hero.png', url: '/api/images/7', size: 2048, created_at: '2026-09-15T10:00:00Z' }

function mockFetch(list: unknown, opts: { deleteStatus?: number } = {}) {
  return vi.fn(async (url: string, options?: RequestInit) => {
    void url
    if (options?.method === 'DELETE') {
      return { ok: (opts.deleteStatus ?? 200) === 200, status: opts.deleteStatus ?? 200, json: async () => ({ ok: true }) }
    }
    if (options?.method === 'POST') {
      return { ok: true, status: 200, json: async () => ({ id: 8, url: '/api/images/8' }) }
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
