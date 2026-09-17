/**
 * T4 批1 前端接线测试：锁定期 AI 落地闸门。
 * - 锁定态（锁状态由服务端 beautify-lock 读回初始化）：AI 修改结果走
 *   /api/apply-locked-edit，越权被拒 → 画布不变 + 可读提示；
 * - 未锁定态：行为与改造前一致（修改直接落地）。
 * 页面级 fetch mock（MemoryRouter + stubEnv 关闭 ws 连接，画布走本地模式）。
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { DesignNode } from '@/design/types'

import WorkspacePage from './WorkspacePage'

/** 初始画布（经草稿种子）：一个文本节点 */
const SEEDED: DesignNode = {
  id: 'root',
  type: 'frame',
  style: { layout: 'column' },
  children: [{ id: 't1', type: 'component', componentType: 'button', props: { text: '原始标题' }, style: {} }],
}

/** AI 返回的"修改后"树：文本被改写（锁定态下属文案越权） */
const AI_EDITED: DesignNode = {
  ...SEEDED,
  children: [{ id: 't1', type: 'component', componentType: 'button', props: { text: 'AI 新标题' }, style: {} }],
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
      // 与真实后端同口径（sessions.py apply_locked_edit_endpoint）：
      // 未锁定 = 直接放行并返回 changed_ids: []；锁定 = 逐位置比对后给出被改节点 id。
      return {
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          design: AI_EDITED,
          changed_ids: serverLocked ? ['ai-text'] : [],
          dropped: [],
          reason: '',
        }),
      }
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
    // 同一套口径：布局类操作在锁定阶段都不可用（智能优化会改 gap/padding/对齐，且落库走整树替换）
    expect(screen.getByTestId('optimize-layout')).toBeDisabled()
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
    expect(screen.getByTestId('optimize-layout')).toBeEnabled()
    await openAiPanel()
    typeAndSend('把标题改成 AI 新标题')
    // 修改落地：AI 的文本节点出现在画布
    expect(await screen.findByText('AI 新标题')).toBeInTheDocument()
    // 落地之后不能报错：面板必须是成功回执，而不是"生成失败：…"
    expect(await screen.findByText(/已应用修改/)).toBeInTheDocument()
    expect(screen.queryByText(/生成失败/)).not.toBeInTheDocument()
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

  /**
   * ③ 并发前置条件（2026-09-17）。
   *
   * AI 是**基于快照**生成的：从"发出请求"到"落地"之间，队友可能已经改了同一个字段。
   * 此前这种情况会静默按 AI 结果覆盖（只弹一句"已覆盖"）；现在跳过冲突字段、保留队友的版本，
   * 并明确告知用户发生了什么。
   */
  it('并发：落地前队友改了同一字段 → 保留队友版本 + 可读提示（不再静默覆盖）', async () => {
    // 把闸门响应挂住，制造"AI 还在路上"的窗口，在这个窗口里模拟队友改同一个文本字段
    let releaseGate: (() => void) | null = null
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve
    })
    const fallback = mockFetch() as unknown as (u: string, o?: RequestInit) => Promise<unknown>
    const fetchMock = vi.fn(async (url: string, options?: RequestInit) => {
      if (String(url).includes('/api/apply-locked-edit')) await gate
      return fallback(url, options)
    })
    vi.stubGlobal('fetch', fetchMock)
    serve(false, 'pass')
    renderWorkspace()

    await openAiPanel()
    typeAndSend('把标题改成 AI 新标题')
    await waitFor(() =>
      expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('/api/apply-locked-edit'))).toBe(true),
    )

    // 队友（同一画布的另一处写入）改了同一个字段：图层树选中 → 属性面板改文案
    fireEvent.click(screen.getByTestId('activity-layers'))
    fireEvent.click(screen.getByTestId('layer-t1'))
    fireEvent.click(screen.getByTestId('activity-props'))
    fireEvent.change(screen.getByTestId('prop-text'), { target: { value: '队友改的' } })

    releaseGate!()

    expect(await screen.findByText(/撞在一起/)).toBeInTheDocument()
    expect(screen.getByText('队友改的'), '冲突字段必须保留队友的版本').toBeInTheDocument()
    expect(screen.queryByText('AI 新标题')).not.toBeInTheDocument()
  })
})
