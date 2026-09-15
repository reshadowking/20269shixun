/**
 * T4 批1 前端接线测试：锁定期 AI 落地闸门。
 * - 锁定态（锁状态由服务端 beautify-lock 读回初始化）：AI 修改结果走
 *   /api/apply-locked-edit，越权被拒 → 画布不变 + 可读提示；
 * - 未锁定态：行为与改造前一致（修改直接落地）。
 * 页面级 fetch mock（MemoryRouter + stubEnv 关闭 ws 连接，画布走本地模式）。
 */
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { DesignNode } from '@/design/types'

import WorkspacePage from './WorkspacePage'

/** 初始画布（经草稿种子）：一个文本节点 */
const SEEDED: DesignNode = {
  id: 'root',
  type: 'frame',
  style: { layout: 'column' },
  children: [{ id: 't1', type: 'text', props: { text: '原始标题' }, style: {} }],
}

/** AI 返回的"修改后"树：文本被改写（锁定态下属文案越权） */
const AI_EDITED: DesignNode = {
  ...SEEDED,
  children: [{ id: 't1', type: 'text', props: { text: 'AI 新标题' }, style: {} }],
}

type LockState = boolean
let serverLocked: LockState
let gateVerdict: 'reject' | 'pass'

function serve(locked: LockState, verdict: 'reject' | 'pass') {
  serverLocked = locked
  gateVerdict = verdict
}

function mockFetch() {
  return vi.fn(async (url: string, options?: RequestInit) => {
    const path = String(url)
    const method = options?.method ?? 'GET'
    if (path.includes('/api/sessions')) {
      if (path.includes('/beautify-lock')) {
        if (method === 'GET') return { ok: true, status: 200, json: async () => ({ locked: serverLocked }) }
        return { ok: true, status: 200, json: async () => ({ ok: true, locked: serverLocked }) }
      }
      if (path.includes('/messages')) return { ok: true, status: 200, json: async () => ({ messages: [], pruned: 0 }) }
      if (path.includes('/tool-calls')) return { ok: true, status: 200, json: async () => ({ ok: true, id: 1 }) }
      if (method === 'POST') return { ok: true, status: 200, json: async () => ({ session_id: 's-gate', title: 't', design_id: null, created_at: null, updated_at: null }) }
      if (path.includes('/api/sessions?')) return { ok: true, status: 200, json: async () => ({ sessions: [], total: 0 }) }
      return { ok: true, status: 200, json: async () => ({ session_id: 's-gate', title: 't', design_id: null, created_at: null, updated_at: null, agent_state: {} }) }
    }
    if (path.includes('/api/apply-locked-edit')) {
      const body = JSON.parse(String(options?.body ?? '{}'))
      lastGateBody = body
      if (gateVerdict === 'reject') {
        return { ok: true, status: 200, json: async () => ({ ok: false, design: body.before, changed_ids: [], dropped: [], reason: '结构变更' }) }
      }
      return { ok: true, status: 200, json: async () => ({ ok: true, design: AI_EDITED, changed_ids: ['ai-text'], dropped: [], reason: '' }) }
    }
    if (path.includes('/api/generate')) {
      return { ok: true, status: 200, json: async () => ({ design: AI_EDITED, template: 'edit', compliance: 100, violations: 0, violations_detail: [], fallback: false, mock: false, error: '', style_attrs: 0 }) }
    }
    throw new Error(`unexpected fetch: ${method} ${path}`)
  })
}

let lastGateBody: Record<string, unknown> | null = null

function renderWorkspace() {
  return render(
    <MemoryRouter initialEntries={['/workspace?session=s-gate&from=draft']}>
      <WorkspacePage />
    </MemoryRouter>,
  )
}

function typeAndSend(text: string) {
  fireEvent.change(screen.getByTestId('chat-input'), { target: { value: text } })
  fireEvent.click(screen.getByTestId('chat-send'))
}

/** 聊天面板挂在活动栏下（默认 props，单面板互斥）：发消息前先切到 ai 面板 */
async function openAiPanel() {
  fireEvent.click(screen.getByTestId('activity-ai'))
  expect(await screen.findByTestId('chat-input')).toBeInTheDocument()
}

describe('T4 批1：锁定期 AI 落地闸门（页面接线）', () => {
  beforeEach(() => {
    localStorage.clear()
    lastGateBody = null
    vi.stubEnv('VITE_WS_URL', '') // 本地模式：测试不连 y-websocket
    // 种一份草稿：画布非空（convert-free 锚点可渲染），文案断言可观察
    localStorage.setItem(
      'design-draft-s-gate',
      JSON.stringify({ design: SEEDED, meta: { updatedAt: Date.now() } }),
    )
    // jsdom 无 ResizeObserver（画布/部分 UI 组件需要）：最小桩实现
    class RO {
      observe = vi.fn()
      unobserve = vi.fn()
      disconnect = vi.fn()
    }
    vi.stubGlobal('ResizeObserver', RO)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    localStorage.clear()
  })

  it('锁定态：初始化读服务端锁（刷新不丢锁），AI 越权被拒且画布不变', async () => {
    const fetchMock = mockFetch()
    vi.stubGlobal('fetch', fetchMock)
    serve(true, 'reject')
    renderWorkspace()

    // 锁状态从服务端初始化（item 10）：layoutLocked=true → 转自由画布按钮禁用
    expect(await screen.findByTestId('convert-free')).toBeDisabled()
    await openAiPanel()
    typeAndSend('把标题改成 AI 新标题')
    // 可读提示出现（面板消息 + 工作台横幅同源）
    expect(await screen.findByText(/版面锁拒绝/)).toBeInTheDocument()
    expect(await screen.findByText(/已阻止/)).toBeInTheDocument()
    // 画布不变：原文案仍在，AI 的文案没有落地
    expect(screen.getByText('原始标题')).toBeInTheDocument()
    expect(screen.queryByText('AI 新标题')).not.toBeInTheDocument()
    // 走了闸门且带 session_key；请求体不含 locked 声明（B 决策）
    expect(lastGateBody).not.toBeNull()
    expect(lastGateBody?.session_key).toBe('s-gate')
    expect(lastGateBody).not.toHaveProperty('locked')
    // 闸门调用发生在 generate 之后
    const callOrder = fetchMock.mock.calls.map((c) => String(c[0]))
    expect(callOrder.findIndex((u) => u.includes('/api/generate'))).toBeGreaterThanOrEqual(0)
    expect(callOrder.some((u) => u.includes('/api/apply-locked-edit'))).toBe(true)
  })

  it('未锁定态：AI 修改直接落地（行为与改造前一致）', async () => {
    vi.stubGlobal('fetch', mockFetch())
    serve(false, 'pass')
    renderWorkspace()

    // 未锁定初始化：转自由画布按钮可用
    expect(await screen.findByTestId('convert-free')).toBeEnabled()
    await openAiPanel()
    typeAndSend('把标题改成 AI 新标题')
    // 修改落地：AI 的文本节点出现在画布
    expect(await screen.findByText('AI 新标题')).toBeInTheDocument()
    // 仍然走了闸门（始终调用），服务端放行
    expect(lastGateBody?.session_key).toBe('s-gate')
    expect(screen.queryByText(/已阻止/)).not.toBeInTheDocument()
  })

  it('锁定态：服务端放行（合法效果）时修改照常落地', async () => {
    vi.stubGlobal('fetch', mockFetch())
    serve(true, 'pass')
    renderWorkspace()
    expect(await screen.findByTestId('convert-free')).toBeDisabled()
    await openAiPanel()
    typeAndSend('给按钮加个阴影')
    expect(await screen.findByText('AI 新标题')).toBeInTheDocument()
    expect(screen.queryByText(/已阻止/)).not.toBeInTheDocument()
  })

  it('闸门网络异常：画布保持原样并提示重试', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string, options?: RequestInit) => {
      if (String(url).includes('/api/apply-locked-edit')) throw new TypeError('network down')
      const fallback = mockFetch() as unknown as (u: string, o?: RequestInit) => Promise<unknown>
      return fallback(url, options)
    }))
    serve(true, 'reject')
    renderWorkspace()
    expect(await screen.findByTestId('convert-free')).toBeDisabled()
    await openAiPanel()
    typeAndSend('把标题改成 AI 新标题')
    expect(await screen.findByText(/未能确认/)).toBeInTheDocument()
    expect(screen.getByText('原始标题')).toBeInTheDocument()
    expect(screen.queryByText('AI 新标题')).not.toBeInTheDocument()
  })
})
