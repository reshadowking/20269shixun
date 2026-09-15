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

  /**
   * 代码产物展示（需求「Web管理控制台 · 代码产物展示」）：
   * 默认 Tab 必须是 React 代码，且展示内容与 ZIP 内容同源。
   */
  it('默认展示 React 代码（而非 HTML 预览）', () => {
    render(<ExportDialog design={DESIGN} onClose={() => {}} />)
    const panel = screen.getByTestId('export-code-panel')
    expect(panel).toBeInTheDocument()
    expect(screen.getByTestId('code-filename')).toHaveTextContent('src/App.tsx')
    expect(screen.getByTestId('code-body')).toHaveTextContent('export default function App')
    expect(screen.getByTestId('code-body')).toHaveTextContent('立即购买')
    // 默认不应出现 HTML 预览
    expect(screen.queryByTestId('export-preview')).not.toBeInTheDocument()
  })

  it('展示的代码与提交给 /api/export 的 src/App.tsx 完全一致（单一同源）', async () => {
    render(<ExportDialog design={DESIGN} onClose={() => {}} />)
    const shown = screen.getByTestId('code-body').textContent ?? ''
    fireEvent.click(screen.getByTestId('export-download'))
    await waitFor(() => expect(clickSpy).toHaveBeenCalled())
    const body = JSON.parse(String(fetchMock.mock.calls[0][1].body))
    // 行号列是 aria-hidden 且单独渲染，正文 block 的 textContent 即代码本身
    expect(body.files['src/App.tsx'].trim()).toBe(shown.trim())
  })

  it('文件树列出工程实际文件（含 preview.html），点击可查看该文件', () => {
    render(<ExportDialog design={DESIGN} onClose={() => {}} />)
    fireEvent.click(screen.getByTestId('export-tab-files'))
    expect(screen.getByTestId('export-files-panel')).toBeInTheDocument()
    for (const p of ['package.json', 'src/App.tsx', 'index.html', 'preview.html', 'README.md']) {
      expect(screen.getByTestId(`export-file-${p}`)).toBeInTheDocument()
    }
    fireEvent.click(screen.getByTestId('export-file-preview.html'))
    expect(screen.getByTestId('code-filename')).toHaveTextContent('preview.html')
    expect(screen.getByTestId('code-body')).toHaveTextContent('<!doctype html>')
  })

  it('ZIP 内含自包含 preview.html，且成功提示写明两种查看方式', async () => {
    render(<ExportDialog design={DESIGN} onClose={() => {}} />)
    fireEvent.click(screen.getByTestId('export-download'))
    await waitFor(() => expect(clickSpy).toHaveBeenCalled())
    const body = JSON.parse(String(fetchMock.mock.calls[0][1].body))
    expect(body.files['preview.html']).toContain('<!doctype html>')
    const success = await screen.findByTestId('export-success')
    expect(success).toHaveTextContent('preview.html')
    expect(success).toHaveTextContent('src/App.tsx')
  })

  it('不再出现会误导产物格式的「静态 HTML 预览」措辞', () => {
    render(<ExportDialog design={DESIGN} onClose={() => {}} />)
    fireEvent.click(screen.getByTestId('export-tab-preview'))
    expect(screen.queryByText('静态 HTML 预览')).not.toBeInTheDocument()
    expect(screen.getByText(/仅预览用，导出物为 React 工程/)).toBeInTheDocument()
  })
})
