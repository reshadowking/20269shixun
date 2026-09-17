/**
 * T43「从资产库插入图片」的落地契约（2026-09-17）。
 *
 * 原实现只在 `[loaded, searchParams]` 变化时跑，而它自己给出的提示是
 * "请先选中一个「图片」组件，再点资产库的「插入到画布」" —— 用户照做（选中图片组件）之后
 * effect 不会再跑，**插入永远不会发生**。探针实测（改前）：
 *
 *   [探针] 初始提示 = 已从资产库带回图片：请先选中一个「图片」组件，再点资产库的「插入到画布」。
 *   [探针] 选中图片组件后提示 = （原样不动）
 *
 * 现在选中项进入依赖：选中图片组件那一刻就落地；插入后从 URL 去掉 `?asset=`，
 * 否则之后每改选一次节点都会把同一张图再插一遍。
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { DesignNode } from '@/design/types'

import WorkspacePage from './WorkspacePage'

function LocationProbe() {
  const loc = useLocation()
  return <div data-testid="probe-loc">{loc.search}</div>
}

function json(body: unknown) {
  return { ok: true, status: 200, json: async () => body }
}

function mockFetch() {
  return vi.fn(async (url: string) => {
    const path = String(url)
    if (path.includes('/beautify-lock')) return json({ locked: false })
    if (path.includes('/messages')) return json({ messages: [], pruned: 0 })
    if (path.includes('/tool-calls')) return json({ ok: true, id: 1 })
    if (path.includes('/api/sessions?')) return json({ sessions: [], total: 0 })
    if (path.includes('/api/sessions')) {
      return json({
        session_id: 's-asset',
        title: 't',
        design_id: null,
        created_at: null,
        updated_at: null,
        agent_state: {},
      })
    }
    return json({})
  })
}

const WITH_IMAGE: DesignNode = {
  id: 'root',
  type: 'frame',
  style: { layout: 'column' },
  children: [
    { id: 't1', type: 'text', props: { text: '标题' } },
    { id: 'img1', type: 'component', componentType: 'image', props: {} },
  ],
}

/** 只有文字、没有图片组件：用来验"没东西可插时"的提示路径 */
const NO_IMAGE: DesignNode = {
  id: 'root',
  type: 'frame',
  style: { layout: 'column' },
  children: [{ id: 't1', type: 'text', props: { text: '标题' } }],
}

function renderAt(url: string, seed: DesignNode) {
  localStorage.setItem('design-draft-s-asset', JSON.stringify({ design: seed, meta: { updatedAt: Date.now() } }))
  vi.stubGlobal('fetch', mockFetch())
  render(
    <MemoryRouter initialEntries={[url]}>
      <WorkspacePage />
      <LocationProbe />
    </MemoryRouter>,
  )
}

describe('资产库「插入到画布」', () => {
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

  it('选中图片组件那一刻就插入（改前：提示叫你选中，选中后却什么都不发生）', async () => {
    renderAt('/workspace?session=s-asset&from=draft&asset=7', WITH_IMAGE)
    fireEvent.click(await screen.findByTestId('activity-layers'))
    await screen.findByTestId('layer-img1')

    // 还没选中：给出可执行的提示
    expect(await screen.findByTestId('beautify-blocked-hint')).toHaveTextContent('请先选中')

    fireEvent.click(screen.getByTestId('layer-img1'))

    await waitFor(() =>
      expect(screen.getByTestId('beautify-blocked-hint')).toHaveTextContent('已把资产库图片插入选中的图片组件'),
    )
    // 插完就把 ?asset= 从 URL 摘掉：否则之后每改选一次节点都会重插，并多推一个撤销步
    await waitFor(() => expect(screen.getByTestId('probe-loc').textContent).not.toContain('asset='))
  })

  it('画布上没有图片组件时：提示一次、不静默丢弃、也不插到别处', async () => {
    renderAt('/workspace?session=s-asset&from=draft&asset=7', NO_IMAGE)
    fireEvent.click(await screen.findByTestId('activity-layers'))
    await screen.findByTestId('layer-t1')

    expect(await screen.findByTestId('beautify-blocked-hint')).toHaveTextContent('请先选中')
    // 选中一个非图片组件（文字）：仍然不插，且 `?asset=` 还留着（提示仍然可执行）
    fireEvent.click(screen.getByTestId('layer-t1'))
    await new Promise((r) => setTimeout(r, 50))
    expect(screen.queryByTestId('beautify-blocked-hint')?.textContent ?? '').toContain('请先选中')
    expect(screen.getByTestId('probe-loc').textContent).toContain('asset=7')
  })
})
