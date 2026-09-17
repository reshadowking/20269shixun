/**
 * 历史版本面板（缺陷 16/17）契约（2026-09-17 补）：
 * 1) 渲染版本列表（版本号/备注/时间/节点数）；
 * 2) 「恢复」**只把选中的树交给上层**（本地应用），自己不发任何写请求 ——
 *    落库由用户再点「保存」完成（确认框里必须说清这一点，避免"以为已恢复、其实没写回"）；
 * 3) 取消确认 → 不恢复；未保存的设计（无 savedId）只提示先保存。
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { DesignNode } from '@/design/types'

import HistoryPanel from './HistoryPanel'

const V2: DesignNode = {
  id: 'root',
  type: 'frame',
  style: { layout: 'column' },
  children: [{ id: 't', type: 'text', props: { text: 'v2 的内容' } }],
}
const V1: DesignNode = { ...V2, children: [{ id: 't', type: 'text', props: { text: 'v1 的内容' } }] }

function mockFetch() {
  // 显式声明第二个参数：测试里要检查"有没有发出写请求"（method 存在时才是写）
  return vi.fn(async (url: string, _init?: RequestInit) => {
    const path = String(url)
    if (path.includes('/versions')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          versions: [
            { id: 2, version_no: 2, note: '里程碑', created_at: '2026-09-17T10:00:00Z', design: V2 },
            { id: 1, version_no: 1, note: '', created_at: '2026-09-16T10:00:00Z', design: V1 },
          ],
        }),
      }
    }
    throw new Error(`unexpected fetch: ${path}`)
  })
}

function renderPanel(overrides: { savedId?: number; onRestore?: (d: DesignNode) => void } = {}) {
  const onRestore = overrides.onRestore ?? vi.fn()
  render(<HistoryPanel design={V2} savedId={overrides.savedId ?? 7} onRestore={onRestore} onVersionSaved={vi.fn()} />)
  return { onRestore }
}

describe('HistoryPanel', () => {
  beforeEach(() => {
    vi.stubGlobal('confirm', vi.fn(() => true))
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('渲染版本列表（版本号/备注/节点数）', async () => {
    vi.stubGlobal('fetch', mockFetch())
    renderPanel()
    const list = await screen.findByTestId('history-list')
    expect(list).toHaveTextContent('v2 · 里程碑')
    expect(list).toHaveTextContent('v1')
    expect(list).toHaveTextContent('2 节点')
  })

  it('恢复：确认后只调用 onRestore（本地应用），自己不写服务器', async () => {
    const fetchMock = mockFetch()
    vi.stubGlobal('fetch', fetchMock)
    const { onRestore } = renderPanel()

    fireEvent.click(await screen.findByTestId('history-restore-1'))

    expect(onRestore).toHaveBeenCalledTimes(1)
    expect((onRestore as unknown as { mock: { calls: DesignNode[][] } }).mock.calls[0][0]).toEqual(V1)
    expect(await screen.findByTestId('history-msg')).toHaveTextContent('已恢复到 v1')
    // 契约：恢复这一步**不发任何写请求**（PUT/POST 都没有），落库靠用户再点保存
    const writes = fetchMock.mock.calls.filter((c) => {
      const init = c[1] as RequestInit | undefined
      return init?.method === 'PUT' || init?.method === 'POST'
    })
    expect(writes).toEqual([])
  })

  it('确认框必须说清"恢复只改本地画布、需再保存才写回服务器"', async () => {
    vi.stubGlobal('fetch', mockFetch())
    const confirmSpy = vi.fn((_message?: string) => true)
    vi.stubGlobal('confirm', confirmSpy)
    renderPanel()

    fireEvent.click(await screen.findByTestId('history-restore-2'))

    expect(confirmSpy).toHaveBeenCalledTimes(1)
    const text = String(confirmSpy.mock.calls[0][0])
    expect(text).toContain('恢复到 v2')
    expect(text).toContain('保存')
    expect(text).toContain('服务器')
  })

  it('取消确认 → 不恢复', async () => {
    vi.stubGlobal('fetch', mockFetch())
    vi.stubGlobal('confirm', vi.fn(() => false))
    const { onRestore } = renderPanel()

    fireEvent.click(await screen.findByTestId('history-restore-1'))

    expect(onRestore).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.queryByTestId('history-msg')).not.toBeInTheDocument())
  })

  it('未保存的设计：只提示先保存，不请求版本列表', async () => {
    const fetchMock = mockFetch()
    vi.stubGlobal('fetch', fetchMock)
    render(<HistoryPanel design={V2} onRestore={vi.fn()} onVersionSaved={vi.fn()} />)

    expect(await screen.findByTestId('history-unsaved')).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
