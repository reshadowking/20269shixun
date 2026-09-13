/**
 * 聊天面板追问流程测试（Q2 跳过按钮 / Q3 快捷指令 / Q4 追问判断 → 生成）。
 * fetch 按 URL 分流 mock：/api/generate/questions → 追问判断；/api/generate → 生成结果。
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import AIChatPanel, { extractPreviewTexts } from './AIChatPanel'
import type { DesignNode } from '@/design/types'

const DESIGN = { id: 'root', type: 'frame', style: { layout: 'column' } }

function mockFetch(questions: { questions: unknown[] } | null, generate?: unknown) {
  return vi.fn(async (url: string, options?: RequestInit) => {
    const path = String(url)
    const body = options?.body ? JSON.parse(String(options.body)) : {}
    if (path.includes('/api/sessions')) {
      // 缺陷 4：会话 API stub（空消息 + 会话元信息），把面板置于正常会话状态
      if (path.includes('/messages')) {
        return { ok: true, status: 200, json: async () => ({ messages: [], pruned: 0 }), body }
      }
      if (path.includes('/tool-calls')) {
        return { ok: true, status: 200, json: async () => ({ ok: true, id: 1 }), body }
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ session_id: 's-test', title: 't', design_id: null, created_at: null, updated_at: null, agent_state: {} }),
        body,
      }
    }
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
  return render(<AIChatPanel sessionKey="s-test" onGenerate={() => {}} />)
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
    render(<AIChatPanel sessionKey="s-test" onGenerate={onGenerate} />)
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
    render(<AIChatPanel sessionKey="s-test" onGenerate={onGenerate} />)
    typeAndSend('做一个电商产品详情页')
    fireEvent.click(await screen.findByTestId('fallback-use-template'))
    expect(onGenerate).toHaveBeenCalledWith(DESIGN)
    expect(await screen.findByText(/已使用预置模板/)).toBeInTheDocument()
    expect(screen.queryByTestId('fallback-actions')).not.toBeInTheDocument()
  })
})

describe('会话隔离：消息只来自当前会话（缺陷 4）', () => {
  it('挂载时只加载本会话消息；其他会话的历史不会出现', async () => {
    localStorage.clear()
    const fetchMock = vi.fn(async (url: string) => {
      const path = String(url)
      if (path.includes('/api/sessions/s-a/messages')) {
        return { ok: true, status: 200, json: async () => ({ messages: [{ id: 1, role: 'assistant', text: '会话 A 的历史' }] }) }
      }
      if (path.includes('/api/sessions/s-b/messages')) {
        return { ok: true, status: 200, json: async () => ({ messages: [{ id: 2, role: 'assistant', text: '会话 B 的历史' }] }) }
      }
      if (path.includes('/api/sessions')) {
        return { ok: true, status: 200, json: async () => ({ session_id: 's-a', title: 't', design_id: null, created_at: null, updated_at: null, agent_state: {} }) }
      }
      throw new Error('unexpected fetch: ' + path)
    })
    vi.stubGlobal('fetch', fetchMock)
    const { unmount } = render(<AIChatPanel sessionKey="s-a" onGenerate={() => {}} />)
    expect(await screen.findByText('会话 A 的历史')).toBeInTheDocument()
    expect(screen.queryByText('会话 B 的历史')).not.toBeInTheDocument()

    unmount()
    render(<AIChatPanel sessionKey="s-b" onGenerate={() => {}} />)
    expect(await screen.findByText('会话 B 的历史')).toBeInTheDocument()
    expect(screen.queryByText('会话 A 的历史')).not.toBeInTheDocument()
  })

  it('新建的空会话：消息列表为空，只显示欢迎语（不继承前一画布历史）', async () => {
    localStorage.clear()
    const fetchMock = vi.fn(async (url: string) => {
      const path = String(url)
      if (path.includes('/api/sessions')) {
        return { ok: true, status: 200, json: async () => ({ messages: [], session_id: 's-new', agent_state: {} }) }
      }
      throw new Error('unexpected fetch: ' + path)
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<AIChatPanel sessionKey="s-new" onGenerate={() => {}} />)
    expect(await screen.findByTestId('chat-msg-assistant-0')).toHaveTextContent('你好！我是 AI 设计助手')
    await waitFor(() => expect(screen.getAllByTestId(/^chat-msg-/)).toHaveLength(1))
  })

  it('历史里存着欢迎语占位（改造前数据）：只显示一条欢迎语', async () => {
    localStorage.clear()
    const fetchMock = vi.fn(async (url: string) => {
      const path = String(url)
      if (path.includes('/api/sessions') && path.includes('/messages')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            messages: [
              { id: 1, role: 'assistant', text: '你好！我是 AI 设计助手。输入你的需求，我帮你生成设计稿。' },
              { id: 2, role: 'user', text: '旧需求' },
            ],
          }),
        }
      }
      if (path.includes('/api/sessions')) {
        return { ok: true, status: 200, json: async () => ({ session_id: 's-legacy', agent_state: {} }) }
      }
      throw new Error('unexpected fetch: ' + path)
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<AIChatPanel sessionKey="s-legacy" onGenerate={() => {}} />)
    expect(await screen.findByText('旧需求')).toBeInTheDocument()
    const welcomes = screen.queryAllByText(/你好！我是 AI 设计助手/)
    expect(welcomes).toHaveLength(1)
  })

  it('会话接口不可用：降级为仅本地可见并提示（不阻塞对话）', async () => {
    localStorage.clear()
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('offline')
    }))
    render(<AIChatPanel sessionKey="s-offline" onGenerate={() => {}} />)
    expect(await screen.findByTestId('session-sync-error')).toHaveTextContent('会话同步失败')
    expect(screen.getByTestId('chat-msg-assistant-0')).toBeInTheDocument()
  })
})

describe('D1 合规逐项报告（B2-2 明细 → UI）', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    localStorage.clear()
    fetchMock = mockFetch({ questions: [] })
  })

  it('生成返回违规明细：报告逐项展示，点还原回调并移除该项，全部接受关闭', async () => {
    const onRestore = vi.fn()
    fetchMock = mockFetch(
      { questions: [] },
      {
        design: DESIGN,
        template: 'login',
        compliance: 50,
        violations: 2,
        fallback: false,
        violations_detail: [
          { node_id: 'btn-1', field: 'background', original: '#123456', corrected: 'text-primary' },
          { node_id: 't-1', field: 'color', original: '#ABCDEF', corrected: 'primary' },
        ],
      },
    )
    vi.stubGlobal('fetch', fetchMock)
    render(<AIChatPanel sessionKey="s-test" onGenerate={() => {}} onComplianceRestore={onRestore} />)
    typeAndSend('设计一个页面')
    await waitFor(() => expect(screen.getByTestId('compliance-report')).toBeInTheDocument())
    expect(screen.getByText(/#123456/)).toBeInTheDocument()
    expect(screen.getByText(/#ABCDEF/)).toBeInTheDocument()

    // 还原第一项：回调携带完整明细，该项从报告消失、另一项保留
    fireEvent.click(screen.getByTestId('compliance-restore-0'))
    expect(onRestore).toHaveBeenCalledWith({
      node_id: 'btn-1',
      field: 'background',
      original: '#123456',
      corrected: 'text-primary',
    })
    await waitFor(() => expect(screen.queryByText(/#123456/)).not.toBeInTheDocument())
    expect(screen.getByText(/#ABCDEF/)).toBeInTheDocument()

    // 全部接受：报告整体关闭
    fireEvent.click(screen.getByTestId('compliance-accept-all'))
    await waitFor(() => expect(screen.queryByTestId('compliance-report')).not.toBeInTheDocument())
  })

  it('无违规明细时不渲染报告块', async () => {
    fetchMock = mockFetch({ questions: [] }) // 默认 generate 响应无 violations_detail
    vi.stubGlobal('fetch', fetchMock)
    render(<AIChatPanel sessionKey="s-test" onGenerate={() => {}} />)
    typeAndSend('设计一个页面')
    await waitFor(() => expect(screen.getByText(/已生成设计稿/)).toBeInTheDocument())
    expect(screen.queryByTestId('compliance-report')).not.toBeInTheDocument()
  })
})

describe('演示模式显式标注（未配置模型 Key = 预置模板稿）', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    localStorage.clear()
  })

  it('mock=true：生成文案明确标注"演示模式…预置模板（非模型生成）"', async () => {
    localStorage.clear()
    const fetchMock = mockFetch({ questions: [] }, { design: DESIGN, template: 'login', compliance: 100, violations: 0, fallback: false, mock: true })
    vi.stubGlobal('fetch', fetchMock)
    render(<AIChatPanel sessionKey="s-test" onGenerate={() => {}} />)
    typeAndSend('设计一个页面')
    await waitFor(() => expect(screen.getByText(/已生成设计稿/)).toBeInTheDocument())
    const msg = screen.getByText(/已生成设计稿/)
    expect(msg).toHaveTextContent('演示模式')
    expect(msg).toHaveTextContent('预置模板（非模型生成）')
  })

  it('mock 缺省（模型产物）：不出现演示模式标注', async () => {
    localStorage.clear()
    const fetchMock = mockFetch({ questions: [] })
    vi.stubGlobal('fetch', fetchMock)
    render(<AIChatPanel sessionKey="s-test" onGenerate={() => {}} />)
    typeAndSend('设计一个页面')
    await waitFor(() => expect(screen.getByText(/已生成设计稿/)).toBeInTheDocument())
    expect(screen.getByText(/已生成设计稿/)).not.toHaveTextContent('演示模式')
  })
})

describe('D3 方案探索', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    localStorage.clear()
    fetchMock = vi.fn(async (url: string, options?: RequestInit) => {
      const path = String(url)
      const body = options?.body ? JSON.parse(String(options.body)) : {}
      if (path.includes('/api/generate/explore')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            options: [
              { label: '方案一 · 默认风格', design: DESIGN, template: 'login', compliance: 100, violations: 0 },
              { label: '方案二 · 差异化风格', design: DESIGN, template: 'login', compliance: 95, violations: 1 },
            ],
            degraded: false,
            body,
          }),
        }
      }
      if (path.includes('/api/generate/questions')) {
        return { ok: true, status: 200, json: async () => ({ questions: [] }) }
      }
      if (path.includes('/api/generate')) {
        return { ok: true, status: 200, json: async () => ({ design: DESIGN, template: 'login', compliance: 100, violations: 0, fallback: false }) }
      }
      throw new Error(`unexpected fetch: ${path}`)
    })
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    localStorage.clear()
  })

  it('探索返回 2 份方案：点使用回调并关闭面板', async () => {
    const onUse = vi.fn()
    render(<AIChatPanel sessionKey="s-test" onGenerate={() => {}} onUseExploreDesign={onUse} />)
    typeAndSend('设计一个登录页') // lastPrompt 就位
    await waitFor(() => expect(screen.getByText(/已生成设计稿/)).toBeInTheDocument())

    fireEvent.click(screen.getByTestId('explore-options'))
    await waitFor(() => expect(screen.getByTestId('explore-result')).toBeInTheDocument())
    expect(screen.getByText('方案一 · 默认风格')).toBeInTheDocument()
    expect(screen.getByText('方案二 · 差异化风格')).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('explore-use-0'))
    expect(onUse).toHaveBeenCalledWith(DESIGN)
    await waitFor(() => expect(screen.queryByTestId('explore-result')).not.toBeInTheDocument())
    expect(screen.getByText(/已加载「方案一/)).toBeInTheDocument()
  })

  it('extractPreviewTexts 抽取树中可见文本', () => {
    const tree: DesignNode = {
      id: 'r',
      type: 'frame',
      children: [
        { id: 't1', type: 'text', props: { text: '你好世界' } },
        { id: 'b1', type: 'component', componentType: 'button', props: { text: '立即购买' } },
      ],
    }
    expect(extractPreviewTexts(tree)).toBe('你好世界 · 立即购买')
  })
})

describe('T4 批2：增量编辑请求携带 locked（仅提示词措辞，非安全开关）', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    localStorage.clear()
  })

  async function sendEditAndCapture(locked?: boolean) {
    const fetchMock = mockFetch({ questions: [] })
    vi.stubGlobal('fetch', fetchMock)
    render(<AIChatPanel sessionKey="s-test" onGenerate={() => {}} design={DESIGN as DesignNode} locked={locked} />)
    // 「把…」是修改类指令：画布有设计 → 增量编辑（携带当前树）
    typeAndSend('把标题改成红色')
    await waitFor(() => {
      expect(fetchMock.mock.calls.some((c) => String(c[0]) === '/api/generate')).toBe(true)
    })
    const gen = fetchMock.mock.calls.find((c) => String(c[0]) === '/api/generate')
    return JSON.parse(String(gen![1]?.body))
  }

  it('locked=true：增量编辑请求体携带 locked=true', async () => {
    const body = await sendEditAndCapture(true)
    expect(body.design).toEqual(DESIGN)
    expect(body.locked).toBe(true)
  })

  it('locked 未传（默认未锁定）：请求体 locked=false，行为向后兼容', async () => {
    const body = await sendEditAndCapture(undefined)
    expect(body.locked).toBe(false)
  })
})

describe('T8 收尾：degraded 降级提示（缺口清单 §4.8）', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    localStorage.clear()
  })

  it('生成结果带 degraded：聊天消息提示「有 N 项能力暂不支持，已用近似组件表达」', async () => {
    const fetchMock = mockFetch(
      { questions: [] },
      { design: DESIGN, template: 'login', compliance: 100, violations: 0, fallback: false, degraded: ['icon@ic', 'tabs@t2'] },
    )
    vi.stubGlobal('fetch', fetchMock)
    render(<AIChatPanel sessionKey="s-test" onGenerate={() => {}} />)
    typeAndSend('设计一个页面')
    await waitFor(() => expect(screen.getByText(/已生成设计稿/)).toBeInTheDocument())
    expect(screen.getByText(/2 项能力暂不支持，已用近似组件表达/)).toBeInTheDocument()
  })

  it('无 degraded：不出现该提示（不加空话）', async () => {
    const fetchMock = mockFetch({ questions: [] })
    vi.stubGlobal('fetch', fetchMock)
    render(<AIChatPanel sessionKey="s-test" onGenerate={() => {}} />)
    typeAndSend('设计一个页面')
    await waitFor(() => expect(screen.getByText(/已生成设计稿/)).toBeInTheDocument())
    expect(screen.queryByText(/项能力暂不支持/)).not.toBeInTheDocument()
  })
})

describe('T10：守卫分级（增量路径放行，缺口清单 §4.9）', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    localStorage.clear()
  })

  it('有设计稿 + 「加高级功能」：请求发出、不显示角色拒答', async () => {
    const fetchMock = mockFetch({ questions: [] })
    vi.stubGlobal('fetch', fetchMock)
    render(<AIChatPanel sessionKey="s-test" onGenerate={() => {}} design={DESIGN as DesignNode} />)
    typeAndSend('加高级功能')
    await waitFor(() => {
      expect(fetchMock.mock.calls.some((c) => String(c[0]) === '/api/generate')).toBe(true)
    })
    expect(screen.queryByText(/只负责 UI/)).not.toBeInTheDocument()
  })

  it('无设计稿 + 同句：仍被拦（首轮守卫强度保持）', async () => {
    const fetchMock = mockFetch({ questions: [] })
    vi.stubGlobal('fetch', fetchMock)
    render(<AIChatPanel sessionKey="s-test" onGenerate={() => {}} />)
    typeAndSend('加高级功能')
    expect(await screen.findByText(/只负责 UI/)).toBeInTheDocument()
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('/api/generate'))).toBe(false)
  })

  it('有设计稿但无编辑动词（今天天气怎么样）：仍被拦', async () => {
    const fetchMock = mockFetch({ questions: [] })
    vi.stubGlobal('fetch', fetchMock)
    render(<AIChatPanel sessionKey="s-test" onGenerate={() => {}} design={DESIGN as DesignNode} />)
    typeAndSend('今天天气怎么样')
    expect(await screen.findByText(/只负责 UI/)).toBeInTheDocument()
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('/api/generate'))).toBe(false)
  })
})
