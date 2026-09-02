/**
 * AIChatPanel 增量编辑测试（P0-1）：
 * - 修改类指令 → 请求携带当前树、不追问、onIncrementalEdit 收到变更 id
 * - 撤销指令 → onUndo 回调
 * - 增量失败 → 画布不动，提示重试
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { DesignNode } from '@/design/types'

import AIChatPanel from './AIChatPanel'

const CURRENT: DesignNode = {
  id: 'root',
  type: 'frame',
  style: { layout: 'column' },
  children: [
    { id: 'title', type: 'text', props: { text: '商品标题' }, style: { color: 'text-primary' } },
    { id: 'buy', type: 'component', componentType: 'button', props: { text: '加入购物车' }, style: { width: 160 } },
  ],
}

const EDITED: DesignNode = {
  id: 'root',
  type: 'frame',
  style: { layout: 'column' },
  children: [
    { id: 'title', type: 'text', props: { text: '商品标题' }, style: { color: 'text-primary' } },
    { id: 'buy', type: 'component', componentType: 'button', props: { text: '加入购物车' }, style: { width: 200, color: 'danger' } },
  ],
}

function mockFetch() {
  return vi.fn(async (url: string) => {
    const path = String(url)
    if (path.includes('/api/generate')) {
      return { ok: true, status: 200, json: async () => ({ design: EDITED, template: 'edit', compliance: 100, violations: 0, fallback: false }) }
    }
    throw new Error(`unexpected fetch: ${path}`)
  })
}

function typeAndSend(text: string) {
  fireEvent.change(screen.getByTestId('chat-input'), { target: { value: text } })
  fireEvent.click(screen.getByTestId('chat-send'))
}

describe('AIChatPanel incremental edit (P0-1)', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = mockFetch()
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('修改指令携带当前树，跳过追问，回调收到变更 id', async () => {
    const onIncrementalEdit = vi.fn()
    render(
      <AIChatPanel
        onGenerate={() => {}}
        design={CURRENT}
        onIncrementalEdit={onIncrementalEdit}
        onUndo={() => {}}
      />,
    )
    typeAndSend('把购买按钮改成红色')
    await waitFor(() => {
      expect(onIncrementalEdit).toHaveBeenCalledTimes(1)
    })
    // 请求体带 design，且没调 questions 接口（跳过追问）
    const genCall = fetchMock.mock.calls.find((c) => String(c[0]) === '/api/generate')
    const body = JSON.parse(String(genCall![1]?.body))
    expect(body.design).toEqual(CURRENT)
    expect(body.prompt).toBe('把购买按钮改成红色')
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('questions'))).toBe(false)
    // 变更 id 只有 buy
    const [newDesign, changed] = onIncrementalEdit.mock.calls[0]
    expect(newDesign).toEqual(EDITED)
    expect(changed).toEqual(['buy'])
  })

  it('新设计指令不带 design，走全量生成', async () => {
    const onIncrementalEdit = vi.fn()
    render(
      <AIChatPanel
        onGenerate={() => {}}
        design={CURRENT}
        onIncrementalEdit={onIncrementalEdit}
        onUndo={() => {}}
      />,
    )
    typeAndSend('设计一个登录页')
    await waitFor(() => {
      const genCall = fetchMock.mock.calls.find((c) => String(c[0]) === '/api/generate')
      expect(genCall).toBeTruthy()
      const body = JSON.parse(String(genCall![1]?.body))
      expect(body.design).toBeUndefined()
    })
    expect(onIncrementalEdit).not.toHaveBeenCalled()
  })

  it('撤销指令触发 onUndo 且不调生成接口', async () => {
    const onUndo = vi.fn()
    render(
      <AIChatPanel
        onGenerate={() => {}}
        design={CURRENT}
        onIncrementalEdit={() => {}}
        onUndo={onUndo}
      />,
    )
    typeAndSend('撤销')
    expect(onUndo).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('/api/generate'))).toBe(false)
    expect(await screen.findByText(/已撤销/)).toBeInTheDocument()
  })

  it('canUndo 时显示撤销按钮', () => {
    render(
      <AIChatPanel
        onGenerate={() => {}}
        design={CURRENT}
        onIncrementalEdit={() => {}}
        onUndo={() => {}}
        canUndo
      />,
    )
    expect(screen.getByTestId('chat-undo')).toBeInTheDocument()
  })

  it('增量失败提示画布保持原样，不显示使用预置模板按钮', async () => {
    fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ design: CURRENT, template: 'edit', compliance: 100, violations: 0, fallback: true, error: '模型超时' }),
    }))
    vi.stubGlobal('fetch', fetchMock)
    render(
      <AIChatPanel
        onGenerate={() => {}}
        design={CURRENT}
        onIncrementalEdit={() => {}}
        onUndo={() => {}}
      />,
    )
    typeAndSend('把按钮改红')
    expect(await screen.findByText(/修改失败（画布保持原样）/)).toBeInTheDocument()
    expect(screen.queryByTestId('fallback-actions')).not.toBeInTheDocument()
  })
})

describe('AIChatPanel 会话持久（P0-2 缺陷 10）', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = mockFetch()
    vi.stubGlobal('fetch', fetchMock)
    localStorage.clear()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    localStorage.clear()
  })

  it('发送消息后写入 localStorage，重新挂载后恢复', async () => {
    const { unmount } = render(
      <AIChatPanel onGenerate={() => {}} onIncrementalEdit={() => {}} onUndo={() => {}} />,
    )
    typeAndSend('设计一个登录页')
    await waitFor(() => {
      expect(localStorage.getItem('design-chat-history')).toContain('设计一个登录页')
    })
    unmount()
    // 重新挂载：历史恢复（用户消息仍在，无需欢迎语）
    render(<AIChatPanel onGenerate={() => {}} onIncrementalEdit={() => {}} onUndo={() => {}} />)
    expect(screen.getAllByText('设计一个登录页').length).toBeGreaterThan(0)
  })

  it('损坏的 localStorage 数据回退默认欢迎语', () => {
    localStorage.setItem('design-chat-history', '{bad json')
    render(<AIChatPanel onGenerate={() => {}} />)
    expect(screen.getByText(/AI 设计助手/)).toBeInTheDocument()
  })

  it('清空会话按钮重置为欢迎语', async () => {
    render(<AIChatPanel onGenerate={() => {}} />)
    typeAndSend('设计一个登录页')
    await waitFor(() => {
      expect(screen.queryByTestId('chat-clear-history')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByTestId('chat-clear-history'))
    expect(screen.queryByText('设计一个登录页')).not.toBeInTheDocument()
    expect(screen.queryByTestId('chat-clear-history')).not.toBeInTheDocument()
  })
})

describe('AIChatPanel 角色边界（P0-3 缺陷 9）', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = mockFetch()
    vi.stubGlobal('fetch', fetchMock)
    localStorage.clear()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    localStorage.clear()
  })

  it('无关问题礼貌拒答，不发生成请求', async () => {
    render(<AIChatPanel onGenerate={() => {}} />)
    typeAndSend('帮我写首诗')
    expect(await screen.findByText(/只负责 UI/)).toBeInTheDocument()
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('/api/generate'))).toBe(false)
  })

  it('设计请求正常放行', async () => {
    render(<AIChatPanel onGenerate={() => {}} />)
    typeAndSend('把按钮改成红色')
    await waitFor(() => {
      expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('/api/generate'))).toBe(true)
    })
    expect(screen.queryByText(/只负责 UI/)).not.toBeInTheDocument()
  })
})
