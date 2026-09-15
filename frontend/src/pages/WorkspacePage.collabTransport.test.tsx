/**
 * T46a-3（卡 §三.1）接线测试：协作到底连哪个端点、哪个房间名。
 *
 * 决策（2026-09-15）：
 *   - 已保存稿件 + 配了 `VITE_WS_GATEWAY_URL` + 无显式 `?room=` → 等 `/collab` 签发房间，连**网关**；
 *   - 草稿（没有 design 参数）→ **不走网关**，直连 `VITE_WS_URL`（房间 session-{key}）；
 *   - 没配网关地址 → 与改造前完全一致（直连 design-{id}）；
 *   - 显式 `?room=`（E2E / 多人同稿）→ 直连该房间名。
 *
 * 用 FakeWebsocketProvider 记录真实建连参数——不真连 WS。
 */
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { DesignNode } from '@/design/types'

import { FakeWebsocketProvider } from '../test/fakeYWebSocket'

import WorkspacePage from './WorkspacePage'

vi.mock('y-websocket', async () => ({
  WebsocketProvider: (await import('../test/fakeYWebSocket')).FakeWebsocketProvider,
}))

const SEEDED: DesignNode = { id: 'root', type: 'frame', style: { layout: 'column' }, children: [] }

function mockFetch(signedRoom = 'SIGNED-ROOM-7') {
  return vi.fn(async (url: string, options?: RequestInit) => {
    const path = String(url)
    const method = options?.method ?? 'GET'
    if (path.includes('/collab')) {
      return { ok: true, status: 200, json: async () => ({ room: signedRoom, role: 'owner', can_edit: true, design_id: 7 }) }
    }
    if (/\/api\/designs\/7/.test(path) && method === 'GET') {
      return { ok: true, status: 200, json: async () => ({ id: 7, name: '稿', design: SEEDED }) }
    }
    if (path.includes('/api/sessions')) {
      if (path.includes('/beautify-lock')) return { ok: true, status: 200, json: async () => ({ locked: false }) }
      if (path.includes('/messages')) return { ok: true, status: 200, json: async () => ({ messages: [], pruned: 0 }) }
      return {
        ok: true,
        status: 200,
        json: async () => ({ sessions: [], total: 0, session_id: 's-t', title: 't', design_id: null, agent_state: {} }),
      }
    }
    throw new Error(`unexpected fetch: ${method} ${path}`)
  })
}

function renderAt(entry: string) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <WorkspacePage />
    </MemoryRouter>,
  )
}

/** 等到 provider 出现（建连由 effect 驱动，异步一跳） */
async function waitForConnect(): Promise<FakeWebsocketProvider> {
  for (let i = 0; i < 40; i++) {
    const last = FakeWebsocketProvider.instances.at(-1)
    if (last) return last
    await new Promise((r) => setTimeout(r, 25))
  }
  throw new Error('provider 一直没建立')
}

describe('§三.1 协作传输决策', () => {
  beforeEach(() => {
    localStorage.clear()
    FakeWebsocketProvider.reset()
    class RO {
      observe = vi.fn()
      unobserve = vi.fn()
      disconnect = vi.fn()
    }
    vi.stubGlobal('ResizeObserver', RO)
    vi.stubEnv('VITE_WS_URL', 'ws://direct:1234')
    vi.stubEnv('VITE_WS_GATEWAY_URL', 'ws://gw:1235')
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    localStorage.clear()
  })

  it('已保存稿件：连网关 + 服务端签发房间（绝不先连可猜的 design-7）', async () => {
    vi.stubGlobal('fetch', mockFetch())
    renderAt('/workspace?design=7')

    const provider = await waitForConnect()
    expect(provider.serverUrl).toBe('ws://gw:1235')
    expect(provider.roomname).toBe('SIGNED-ROOM-7')
    expect(FakeWebsocketProvider.instances.some((p) => p.roomname === 'design-7')).toBe(false)
  })

  it('拿不到签发房间时不连（不做"兜底直连"）+ 给出可读提示', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (String(url).includes('/collab')) throw new TypeError('network down')
        return mockFetch()(url)
      }),
    )
    renderAt('/workspace?design=7')

    expect(await screen.findByTestId('collab-room-error')).toHaveTextContent(/未能获取协作房间/)
    expect(FakeWebsocketProvider.instances).toHaveLength(0)
  })

  it('草稿：不走网关，直连 VITE_WS_URL（房间 session-{key}）', async () => {
    vi.stubGlobal('fetch', mockFetch())
    renderAt('/workspace?from=draft&session=s-draft01')

    const provider = await waitForConnect()
    expect(provider.serverUrl).toBe('ws://direct:1234')
    expect(provider.roomname).toBe('session-s-draft01')
  })

  it('未配网关地址：行为与改造前一致（直连 design-7）', async () => {
    vi.stubEnv('VITE_WS_GATEWAY_URL', '')
    vi.stubGlobal('fetch', mockFetch())
    renderAt('/workspace?design=7')

    const provider = await waitForConnect()
    expect(provider.serverUrl).toBe('ws://direct:1234')
    expect(provider.roomname).toBe('design-7')
  })

  it('显式 ?room=（E2E/多人同稿）：直连该房间名，即使配了网关', async () => {
    vi.stubGlobal('fetch', mockFetch())
    renderAt('/workspace?design=7&room=room-e2e')

    const provider = await waitForConnect()
    expect(provider.serverUrl).toBe('ws://direct:1234')
    expect(provider.roomname).toBe('room-e2e')
  })
})
