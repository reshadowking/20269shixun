/**
 * 组件智能推荐（E3-3）测试：按钮触发、推荐列表展示、点击落位回调、浮层模式。
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import ComponentRecommend, { type RecommendItem } from './ComponentRecommend'
import type { DesignNode } from '@/design/types'

const DESIGN: DesignNode = { id: 'root', type: 'frame', children: [{ id: 'card', type: 'frame', style: { layout: 'column' } }] }

const RECS: RecommendItem[] = [
  { component_type: 'title-text', reason: '空容器先放标题，明确区块用途', suggested_index: 0, default_props: { text: '区块标题', level: 3 } },
  { component_type: 'image', reason: '配图让区块更直观', suggested_index: 1, default_props: { alt: '配图' } },
  { component_type: 'button', reason: '添加行动按钮引导操作', suggested_index: 2, default_props: { text: '立即开始', variant: 'primary' } },
]

function mockFetch() {
  return vi.fn(async (url: string) => {
    if (String(url).includes('/api/recommend-components')) {
      return { ok: true, status: 200, json: async () => ({ recommendations: RECS }) }
    }
    throw new Error(`unexpected fetch: ${url}`)
  })
}

describe('ComponentRecommend', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = mockFetch()
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('embedded: button triggers load and shows 3 recommendations with reason', async () => {
    const onAdd = vi.fn()
    render(<ComponentRecommend design={DESIGN} containerId="card" onAdd={onAdd} />)
    fireEvent.click(screen.getByTestId('recommend-open'))
    expect(await screen.findByTestId('recommend-list')).toBeInTheDocument()
    expect(screen.getAllByTestId(/recommend-item-/)).toHaveLength(3)
    expect(screen.getByTestId('recommend-item-title-text')).toHaveTextContent('空容器先放标题')
    // 请求带容器上下文
    expect(fetchMock.mock.calls[0][1].body).toContain('"container_id":"card"')
  })

  it('clicking a recommendation calls onAdd with target and item', async () => {
    const onAdd = vi.fn()
    render(<ComponentRecommend design={DESIGN} containerId="card" onAdd={onAdd} />)
    fireEvent.click(screen.getByTestId('recommend-open'))
    fireEvent.click(await screen.findByTestId('recommend-item-button'))
    expect(onAdd).toHaveBeenCalledWith('card', RECS[2])
  })

  it('"不推荐，我自己选" dismisses the list', async () => {
    render(<ComponentRecommend design={DESIGN} containerId="card" onAdd={vi.fn()} />)
    fireEvent.click(screen.getByTestId('recommend-open'))
    fireEvent.click(await screen.findByTestId('recommend-dismiss'))
    expect(screen.queryByTestId('recommend-list')).not.toBeInTheDocument()
  })

  it('floating mode loads on mount and positions as popover', async () => {
    render(<ComponentRecommend design={DESIGN} containerId="card" onAdd={vi.fn()} floating={{ x: 120, y: 80 }} onClose={() => {}} />)
    expect(await screen.findByTestId('recommend-popover')).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getAllByTestId(/recommend-item-/)).toHaveLength(3)
    })
  })

  it('renders 4 recommendations (T9.1 #22：表单/商品容器 4 条，UI 不设数量硬约束)', async () => {
    const four = [...RECS, { component_type: 'switch', reason: '开关适合订阅/协议类确认项', suggested_index: 3, default_props: { label: '接收通知' } }]
    fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes('/api/recommend-components')) {
        return { ok: true, status: 200, json: async () => ({ recommendations: four }) }
      }
      throw new Error(`unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<ComponentRecommend design={DESIGN} containerId="card" onAdd={vi.fn()} />)
    fireEvent.click(screen.getByTestId('recommend-open'))
    await waitFor(() => {
      expect(screen.getAllByTestId(/recommend-item-/)).toHaveLength(4)
    })
    expect(screen.getByTestId('recommend-item-switch')).toHaveTextContent('开关适合订阅/协议类确认项')
  })

  it('shows error message on failure', async () => {
    fetchMock = vi.fn(async () => ({ ok: false, status: 500, json: async () => ({ detail: '推荐服务不可用' }) }))
    vi.stubGlobal('fetch', fetchMock)
    render(<ComponentRecommend design={DESIGN} containerId="card" onAdd={vi.fn()} />)
    fireEvent.click(screen.getByTestId('recommend-open'))
    expect(await screen.findByText('推荐服务不可用')).toBeInTheDocument()
  })
})
