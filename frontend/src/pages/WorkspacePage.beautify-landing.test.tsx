/**
 * 美化效果落地的并发安全（2026-09-17）。
 *
 * 服务端 `/api/apply-effects` 只改一个样式字段，但落地走的是 `store.resetDesign(resp.design)`
 * ——**整树替换**：会吞掉队友在这期间的并发改动、让所有人画布整体重挂，并且**清空操作级撤销栈**
 * （与 ③ 里修掉的 AI 落地同一类问题；AI 路径已改差量落地，这里漏了）。
 *
 * 可观测量：应用效果后「↩ 撤销」（`undo-op`，`disabled={!store.canUndo}`）应当**仍可用**。
 * 整树替换会 clear() 撤销栈 → 按钮变灰（改前就是这条断言红）。
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { DesignNode } from '@/design/types'

import WorkspacePage from './WorkspacePage'

const SEEDED: DesignNode = {
  id: 'root',
  type: 'frame',
  style: { layout: 'column' },
  children: [
    { id: 't1', type: 'component', componentType: 'button', props: { text: '提交' }, style: { color: 'primary' } },
  ],
}

/** 服务端返回：只给 t1 加上 radius 的树 */
const APPLIED: DesignNode = {
  ...SEEDED,
  children: [{ ...SEEDED.children![0], style: { color: 'primary', radius: 8 } }],
}

function json(body: unknown) {
  return { ok: true, status: 200, json: async () => body }
}

function mockFetch() {
  return vi.fn(async (url: string, options?: RequestInit) => {
    const path = String(url)
    const method = options?.method ?? 'GET'
    if (path.includes('/beautify-lock')) {
      return method === 'GET' ? json({ locked: false }) : json({ ok: true, locked: false })
    }
    if (path.includes('/api/apply-effects')) {
      const body = JSON.parse(String(options?.body ?? '{}')) as { node_id?: string; effects?: Record<string, unknown> }
      return json({ design: APPLIED, applied: Object.keys(body.effects ?? {}), removed: [] })
    }
    if (path.includes('/messages')) return json({ messages: [], pruned: 0 })
    if (path.includes('/tool-calls')) return json({ ok: true, id: 1 })
    if (path.includes('/api/sessions')) {
      return json({
        session_id: 's-beautify',
        title: 't',
        design_id: null,
        created_at: null,
        updated_at: null,
        agent_state: {},
      })
    }
    throw new Error(`unexpected fetch: ${method} ${path}`)
  })
}

describe('美化效果落地（差量，不清撤销栈）', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.stubEnv('VITE_WS_URL', '') // 本地模式：不连 y-websocket
    localStorage.setItem(
      'design-draft-s-beautify',
      JSON.stringify({ design: SEEDED, meta: { updatedAt: Date.now() } }),
    )
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

  it('应用样式效果后：效果落地、且操作级撤销栈保留（改前 resetDesign 会清空）', async () => {
    const fetchMock = mockFetch()
    vi.stubGlobal('fetch', fetchMock)
    render(
      <MemoryRouter initialEntries={['/workspace?session=s-beautify&from=draft']}>
        <WorkspacePage />
      </MemoryRouter>,
    )

    // 选中按钮节点（图层树点击，等价于画布点选，避开 jsdom 的 pointer capture 差异）
    fireEvent.click(await screen.findByTestId('activity-layers'))
    fireEvent.click(await screen.findByTestId('layer-t1'))
    fireEvent.click(screen.getByTestId('activity-beautify'))
    expect(await screen.findByTestId('beautify-panel')).toBeInTheDocument()

    // 基线：还没做任何可撤销操作
    expect(screen.getByTestId('undo-op')).toBeDisabled()

    // 应用「圆角」的第一个预置值
    fireEvent.click(screen.getByTestId('beautify-radius-0'))

    await waitFor(() => {
      const call = fetchMock.mock.calls.find((c) => String(c[0]).includes('/api/apply-effects'))
      expect(call).toBeTruthy()
      const body = JSON.parse(String((call?.[1] as RequestInit | undefined)?.body ?? '{}'))
      expect(body.node_id).toBe('t1')
    })

    // 差量落地用 store.updateNode（LOCAL_ORIGIN）→ 撤销栈还在；整树替换会 clear() → 按钮变灰
    await waitFor(() => expect(screen.getByTestId('undo-op')).toBeEnabled())
  })
})
