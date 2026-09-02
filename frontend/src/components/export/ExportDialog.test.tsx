/**
 * 导出对话框测试（P0-2）：预览、下载（zip blob）、错误提示、成功提示。
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { DesignNode } from '@/design/types'
import ExportDialog from './ExportDialog'

const DESIGN: DesignNode = {
  id: 'root',
  type: 'frame',
  style: { layout: 'column' },
  children: [{ id: 'b', type: 'component', componentType: 'button', props: { text: '立即购买' } }],
}

function mockFetch() {
  return vi.fn(async () => {
    const encoder = new TextEncoder()
    return {
      ok: true,
      status: 200,
      blob: async () => new Blob([encoder.encode('PK\x03\x04zip-content')], { type: 'application/zip' }),
    }
  })
}

describe('ExportDialog', () => {
  let fetchMock: ReturnType<typeof vi.fn>
  let clickSpy: ReturnType<typeof vi.fn>

  beforeEach(() => {
    localStorage.setItem('design-tool-token', 'test-token')
    fetchMock = mockFetch()
    vi.stubGlobal('fetch', fetchMock)
    clickSpy = vi.fn()
    vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn(() => 'blob:mock'), revokeObjectURL: vi.fn() })
    const origCreateElement = document.createElement.bind(document)
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = origCreateElement(tag)
      if (tag === 'a') el.click = clickSpy as unknown as () => void
      return el
    })
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    localStorage.clear()
  })

  it('预览按钮展示 iframe 静态 HTML', () => {
    render(<ExportDialog design={DESIGN} onClose={() => {}} />)
    fireEvent.click(screen.getByTestId('export-preview-btn'))
    expect(screen.getByTestId('export-preview')).toBeInTheDocument()
    const iframe = screen.getByTitle('设计稿预览')
    expect(iframe.getAttribute('srcDoc')).toContain('<button')
  })

  it('下载按钮请求 /api/export 并触发文件下载', async () => {
    render(<ExportDialog design={DESIGN} onClose={() => {}} />)
    fireEvent.click(screen.getByTestId('export-download'))
    await waitFor(() => {
      expect(clickSpy).toHaveBeenCalled()
    })
    const call = fetchMock.mock.calls[0]
    expect(String(call[0])).toBe('/api/export')
    const body = JSON.parse(String(call[1].body))
    expect(body.files['package.json']).toBeTruthy()
    expect(body.files['src/App.tsx']).toContain('立即购买')
    expect(body.files['src/App.tsx']).toContain('<button')
    expect(call[1].headers.Authorization).toBe('Bearer test-token')
    expect(await screen.findByTestId('export-success')).toBeInTheDocument()
  })

  it('导出失败显示错误信息', async () => {
    fetchMock = vi.fn(async () => ({ ok: false, status: 500, json: async () => ({ detail: '打包失败' }) }))
    vi.stubGlobal('fetch', fetchMock)
    render(<ExportDialog design={DESIGN} onClose={() => {}} />)
    fireEvent.click(screen.getByTestId('export-download'))
    expect(await screen.findByTestId('export-error')).toHaveTextContent('打包失败')
  })

  it('关闭按钮触发 onClose', () => {
    const onClose = vi.fn()
    render(<ExportDialog design={DESIGN} onClose={onClose} />)
    fireEvent.click(screen.getByTestId('export-close'))
    expect(onClose).toHaveBeenCalled()
  })
})
