/**
 * 聊天面板追问流程测试（Q2 跳过按钮 / Q3 快捷指令 / Q4 追问判断 → 生成）。
 * fetch 按 URL 分流 mock：/api/generate/questions → 追问判断；/api/generate → 生成结果。
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import AIChatPanel, { chatStorageKey } from './AIChatPanel'

const DESIGN = { id: 'root', type: 'frame', style: { layout: 'column' } }

function mockFetch(questions: { questions: unknown[] } | null, generate?: unknown) {
  return vi.fn(async (url: string, options?: RequestInit) => {
    const path = String(url)
    const body = options?.body ? JSON.parse(String(options.body)) : {}
    if (path.includes('/api/generate/questions')) {
      return {
        ok: true,
        status: 200,
        json: async () => questions ?? { questions: [] },
        body,
      }
    }
    if (path.includes('/api/generate')) {
      return {
        ok: true,
        status: 200,
        json: async () => generate ?? { design: DESIGN, template: 'login', compliance: 100, violations: 0, fallback: false },
      }
    }
    throw new Error(`unexpected fetch: ${path}`)
  })
}

function typeAndSend(text: string) {
  fireEvent.change(screen.getByTestId('chat-input'), { target: { value: text } })
  fireEvent.click(screen.getByTestId('chat-send'))
}

function renderPanel() {
  return render(<AIChatPanel onGenerate={() => {}} />)
}

describe('AIChatPanel followup flow', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    localStorage.clear()
    fetchMock = mockFetch({ questions: [] })
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    localStorage.clear()
  })

  it('shows followup card when questions are returned (Q4)', async () => {
    renderPanel()
    fetchMock = mockFetch({ questions: [{ key: 'page_type', question: '请问是什么类型的页面？', options: ['登录页', '落地页', '随便选一个'], default: '落地页' }] })
    vi.stubGlobal('fetch', fetchMock)
    typeAndSend('做一个页面')
    expect(await screen.findByTestId('followup-card')).toBeInTheDocument()
    expect(screen.getByTestId('followup-question')).toHaveTextContent('请问是什么类型的页面？')
    // 跳过按钮永远在（Q2）
    expect(screen.getByTestId('followup-skip')).toBeInTheDocument()
    // 未点选项前不调生成接口
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('/api/generate"') || String(c[0]) === '/api/generate')).toBe(false)
  })

  it('choosing an option merges answer into prompt and generates', async () => {
    renderPanel()
    fetchMock = mockFetch({ questions: [{ key: 'page_type', question: '请问是什么类型的页面？', options: ['登录页', '随便选一个'], default: '落地页' }] })
    vi.stubGlobal('fetch', fetchMock)
    typeAndSend('做一个页面')
    fireEvent.click(await screen.findByTestId('followup-option-登录页'))
    await waitFor(() => {
      const gen = fetchMock.mock.calls.find((c) => String(c[0]) === '/api/generate')
      expect(gen).toBeTruthy()
      const body = JSON.parse(String(gen![1]?.body))
      expect(body.prompt).toContain('页面类型：登录页')
    })
    expect(screen.queryByTestId('followup-card')).not.toBeInTheDocument()
  })

  it('"随便选一个" uses the question default value', async () => {
    renderPanel()
    fetchMock = mockFetch({ questions: [{ key: 'page_type', question: '请问是什么类型的页面？', options: ['登录页', '随便选一个'], default: '落地页' }] })
    vi.stubGlobal('fetch', fetchMock)
    typeAndSend('做一个页面')
    fireEvent.click(await screen.findByTestId('followup-option-随便选一个'))
    await waitFor(() => {
      const gen = fetchMock.mock.calls.find((c) => String(c[0]) === '/api/generate')
      const body = JSON.parse(String(gen![1]?.body))
      expect(body.prompt).toContain('页面类型：落地页')
    })
  })

  it('skip button generates with defaults and never asks again (Q2)', async () => {
    renderPanel()
    fetchMock = mockFetch({ questions: [{ key: 'page_type', question: '请问是什么类型的页面？', options: ['登录页', '随便选一个'], default: '落地页' }] })
    vi.stubGlobal('fetch', fetchMock)
    typeAndSend('做一个页面')
    fireEvent.click(await screen.findByTestId('followup-skip'))
    await waitFor(() => {
      const gen = fetchMock.mock.calls.find((c) => String(c[0]) === '/api/generate')
      const body = JSON.parse(String(gen![1]?.body))
      expect(body.prompt).toContain('页面类型：落地页')
    })
    expect(screen.queryByTestId('followup-card')).not.toBeInTheDocument()
  })

  it('generates directly when questions list is empty', async () => {
    renderPanel()
    typeAndSend('设计一个简洁的登录页')
    await waitFor(() => {
      const gen = fetchMock.mock.calls.find((c) => String(c[0]) === '/api/generate')
      expect(gen).toBeTruthy()
    })
    expect(screen.queryByTestId('followup-card')).not.toBeInTheDocument()
  })

  it('"直接生成" quick command skips questions entirely (Q3)', async () => {
    renderPanel()
    typeAndSend('直接生成一个登录页')
    await waitFor(() => {
      const gen = fetchMock.mock.calls.find((c) => String(c[0]) === '/api/generate')
      expect(gen).toBeTruthy()
    })
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('questions'))).toBe(false)
  })

  it('"问详细一点" uses detailed mode for this turn (Q3)', async () => {
    renderPanel()
    typeAndSend('问详细一点，做一个页面')
    await waitFor(() => {
      const q = fetchMock.mock.calls.find((c) => String(c[0]).includes('questions'))
      expect(q).toBeTruthy()
      expect(JSON.parse(String(q![1]?.body)).mode).toBe('detailed')
    })
  })

  it('"简单点" uses concise mode for this turn (Q3)', async () => {
    renderPanel()
    typeAndSend('简单点，做个登录页')
    await waitFor(() => {
      const q = fetchMock.mock.calls.find((c) => String(c[0]).includes('questions'))
      expect(q).toBeTruthy()
      expect(JSON.parse(String(q![1]?.body)).mode).toBe('concise')
    })
  })

  it('questions API failure falls back to direct generation', async () => {
    renderPanel()
    fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes('questions')) {
        return { ok: false, status: 500, json: async () => ({ detail: 'boom' }) }
      }
      return { ok: true, status: 200, json: async () => ({ design: DESIGN, template: 'login', compliance: 100, violations: 0, fallback: false }) }
    })
    vi.stubGlobal('fetch', fetchMock)
    typeAndSend('做一个页面')
    await waitFor(() => {
      expect(fetchMock.mock.calls.some((c) => String(c[0]) === '/api/generate')).toBe(true)
    })
  })

  it('free template shows optimization hint', async () => {
    renderPanel()
    fetchMock = mockFetch({ questions: [] }, { design: DESIGN, template: 'free', compliance: 92, violations: 1, fallback: false })
    vi.stubGlobal('fetch', fetchMock)
    typeAndSend('自由生成一个设置页')
    await waitFor(() => {
      expect(screen.getByText(/自由生成模式/)).toBeInTheDocument()
    })
  })

  it('fallback shows failure card, not silent template injection (P0)', async () => {
    const onGenerate = vi.fn()
    fetchMock = mockFetch(
      { questions: [] },
      { design: DESIGN, template: 'ecommerce', compliance: 81.8, violations: 4, fallback: true, error: '参数填充未返回有效 JSON（模型限流或超时）' },
    )
    vi.stubGlobal('fetch', fetchMock)
    render(<AIChatPanel onGenerate={onGenerate} />)
    typeAndSend('做一个电商产品详情页')
    expect(await screen.findByText(/AI 生成失败/)).toBeInTheDocument()
    expect(screen.getByText(/模型限流或超时/)).toBeInTheDocument()
    expect(onGenerate).not.toHaveBeenCalled()
    expect(screen.getByTestId('fallback-retry')).toBeInTheDocument()
    expect(screen.getByTestId('fallback-use-template')).toHaveTextContent('81.8')
  })

  it('fallback retry re-runs generation', async () => {
    renderPanel()
    fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes('questions')) {
        return { ok: true, status: 200, json: async () => ({ questions: [] }) }
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ design: DESIGN, template: 'ecommerce', compliance: 81.8, violations: 4, fallback: true, error: '超时' }),
      }
    })
    vi.stubGlobal('fetch', fetchMock)
    typeAndSend('做一个电商产品详情页')
    fireEvent.click(await screen.findByTestId('fallback-retry'))
    await waitFor(() => {
      const gens = fetchMock.mock.calls.filter((c) => String(c[0]) === '/api/generate')
      expect(gens.length).toBeGreaterThanOrEqual(2)
    })
  })

  it('fallback "使用预置模板" explicitly puts template on canvas', async () => {
    const onGenerate = vi.fn()
    fetchMock = mockFetch(
      { questions: [] },
      { design: DESIGN, template: 'ecommerce', compliance: 100, violations: 0, fallback: true, error: '超时' },
    )
    vi.stubGlobal('fetch', fetchMock)
    render(<AIChatPanel onGenerate={onGenerate} />)
    typeAndSend('做一个电商产品详情页')
    fireEvent.click(await screen.findByTestId('fallback-use-template'))
    expect(onGenerate).toHaveBeenCalledWith(DESIGN)
    expect(await screen.findByText(/已使用预置模板/)).toBeInTheDocument()
    expect(screen.queryByTestId('fallback-actions')).not.toBeInTheDocument()
  })
})

describe('historyScope 聊天历史分 key（P0-4）', () => {
  it('chatStorageKey：有 scope 按设计隔离，无 scope 保持全局 key（兼容存量数据）', () => {
    expect(chatStorageKey('42')).toBe('design-chat-history-42')
    expect(chatStorageKey(undefined)).toBe('design-chat-history')
  })

  it('挂载时按 scope 读取对应 localStorage key 的历史', () => {
    localStorage.clear()
    localStorage.setItem('design-chat-history-42', JSON.stringify([{ role: 'assistant', text: '来自设计 42 的历史' }]))
    render(<AIChatPanel onGenerate={() => {}} historyScope="42" />)
    expect(screen.getByText('来自设计 42 的历史')).toBeInTheDocument()
    // 全局 key 的数据不会被 scope 会话读到
    expect(screen.queryByText(/你好！我是 AI 设计助手/)).not.toBeInTheDocument()
  })
})
