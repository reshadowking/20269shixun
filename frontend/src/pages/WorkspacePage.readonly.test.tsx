/**
 * T46a-3e 页面接线测试：viewer（只读访客）的写入口一律关掉。
 *
 * 三层防护里这一层测的是前端：
 *   ① 网关丢弃 viewer 写消息（服务端，见 docker/collab-gateway 冒烟）；
 *   ② 写接口 403（服务端，见 backend/tests/test_collab_readonly.py）；
 *   ③ store 写入层拒绝 + UI 禁用（本文件 + designStore.readonly.test.ts）。
 * 页面级 fetch mock（MemoryRouter + 空 VITE_WS_URL 走本地模式，不连 y-websocket）。
 */
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { DesignNode } from '@/design/types'

import WorkspacePage from './WorkspacePage'

const SEEDED: DesignNode = {
  id: 'root',
  type: 'frame',
  style: { layout: 'column' },
  children: [{ id: 't1', type: 'text', props: { text: '只读稿标题' }, style: {} }],
}

function mockFetch(role: 'owner' | 'viewer' | 'editor') {
  return vi.fn(async (url: string, options?: RequestInit) => {
    const path = String(url)
    const method = options?.method ?? 'GET'
    if (path.includes('/collab')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ room: 'room-signed-1', role, can_edit: role !== 'viewer', design_id: 7 }),
      }
    }
    if (/\/api\/designs\/7/.test(path) && method === 'GET') {
      return { ok: true, status: 200, json: async () => ({ id: 7, name: '只读稿', design: SEEDED }) }
    }
    if (path.includes('/api/sessions')) {
      if (path.includes('/beautify-lock')) {
        return { ok: true, status: 200, json: async () => ({ locked: false }) }
      }
      if (path.includes('/messages')) return { ok: true, status: 200, json: async () => ({ messages: [], pruned: 0 }) }
      if (method === 'POST') {
        return {
          ok: true,
          status: 200,
          json: async () => ({ session_id: 's-ro', title: 't', design_id: null, created_at: null, updated_at: null }),
        }
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ sessions: [], total: 0, session_id: 's-ro', title: 't', design_id: null, agent_state: {} }),
      }
    }
    throw new Error(`unexpected fetch: ${method} ${path}`)
  })
}

function renderWorkspace() {
  return render(
    <MemoryRouter initialEntries={['/workspace?design=7']}>
      <WorkspacePage />
    </MemoryRouter>,
  )
}

describe('T46a-3e：只读访客（viewer）', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.stubEnv('VITE_WS_URL', '') // 本地模式：不连 y-websocket
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

  it('viewer：只读徽标 + 写按钮禁用 + 属性面板/AI 入口只读', async () => {
    vi.stubGlobal('fetch', mockFetch('viewer'))
    renderWorkspace()

    // 顶栏只读徽标
    expect(await screen.findByTestId('readonly-badge')).toBeInTheDocument()
    // 写操作按钮禁用（保存 / 智能优化 / 转自由画布）
    expect(screen.getByTestId('save-design')).toBeDisabled()
    expect(screen.getByTestId('optimize-layout')).toBeDisabled()
    expect(screen.getByTestId('convert-free')).toBeDisabled()

    // 仍可选中有看（选中不是写操作）→ 属性面板只读
    fireEvent.pointerDown(screen.getByTestId('node-t1'))
    expect(screen.getByTestId('selection-count').textContent).toContain('已选 1 个节点')
    // 属性面板是默认打开的面板（再点 activity-props 反而是收起）
    expect(await screen.findByTestId('prop-readonly-note')).toBeInTheDocument()
    expect(screen.getByTestId('layer-top')).toBeDisabled()
    expect(screen.getByTestId('prop-delete')).toBeDisabled()
    // 可编辑字段整块不渲染（样式字段是通用字段，最能说明问题）
    expect(screen.queryByTestId('prop-layout')).not.toBeInTheDocument()

    // AI 面板：输入区只读
    fireEvent.click(screen.getByTestId('activity-ai'))
    expect(await screen.findByTestId('chat-readonly-note')).toBeInTheDocument()
    expect(screen.getByTestId('chat-input')).toBeDisabled()
    expect(screen.getByTestId('chat-send')).toBeDisabled()

    // 组件库添加被拦（给出可读原因，不静默）
    fireEvent.click(screen.getByTestId('palette-button'))
    expect(await screen.findByText(/只读访客：不能添加组件/)).toBeInTheDocument()
  })

  it('owner：没有只读徽标，写按钮可用（行为与改造前一致）', async () => {
    vi.stubGlobal('fetch', mockFetch('owner'))
    renderWorkspace()

    // 等角色读回（owner → 不是只读）
    expect(await screen.findByTestId('convert-free')).toBeEnabled()
    expect(screen.queryByTestId('readonly-badge')).not.toBeInTheDocument()
    expect(screen.getByTestId('save-design')).toBeEnabled()

    fireEvent.pointerDown(screen.getByTestId('node-t1'))
    expect(await screen.findByTestId('prop-layout')).toBeInTheDocument()
    expect(screen.queryByTestId('prop-readonly-note')).not.toBeInTheDocument()
  })
})
