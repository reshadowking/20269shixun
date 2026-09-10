/**
 * 缺陷 1 回归：方案预览与对比留档。
 * 覆盖：二选一预览（缩略图/定位/差异）、选定后另一方案仍可查（≤2 击）、
 * 无额外模型调用、重新选择需二次确认、刷新后仍能还原选过的方案、降级方案与真实生成区分。
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import AIChatPanel from './AIChatPanel'
import { exploreArchiveKey, loadExploreArchive } from '@/lib/exploreArchive'
import type { DesignNode } from '@/design/types'

const LIGHT: DesignNode = {
  id: 'opt-light-root',
  type: 'frame',
  style: { layout: 'column', width: 800, height: 600, background: '#F5F5F5' },
  children: [{ id: 'opt-light-t', type: 'text', props: { text: '浅色方案内容' } }],
}

const DARK: DesignNode = {
  id: 'opt-dark-root',
  type: 'frame',
  style: { layout: 'grid', width: 800, height: 600, background: '#141414' },
  children: [{ id: 'opt-dark-t', type: 'text', props: { text: '深色方案内容' } }],
}

function explorePayload(overrides: Record<string, unknown> = {}) {
  return {
    options: [
      { label: '方案一 · 默认风格', design: LIGHT, template: 'login', compliance: 92, violations: 0, fallback: false },
      { label: '方案二 · 差异化风格', design: DARK, template: 'dashboard', compliance: 100, violations: 0, fallback: false },
    ],
    degraded: false,
    ...overrides,
  }
}

function mockFetch(payload: unknown) {
  const calls: string[] = []
  const fetchMock = vi.fn(async (url: string) => {
    calls.push(String(url))
    if (String(url).includes('/api/generate/explore')) {
      return { ok: true, status: 200, json: async () => payload }
    }
    throw new Error(`unexpected fetch: ${url}`)
  })
  return { fetchMock, calls }
}

/** 输入需求 → 点击「探索 2 个方案」→ 等结果面板 */
async function explore(payload = explorePayload()) {
  const mocked = mockFetch(payload)
  vi.stubGlobal('fetch', mocked.fetchMock)
  render(<AIChatPanel onGenerate={() => {}} onUseExploreDesign={useSpy} />)
  fireEvent.change(screen.getByTestId('chat-input'), { target: { value: '设计一个电商优惠券页' } })
  await userEvent.click(screen.getByTestId('explore-options'))
  await screen.findByTestId('explore-result')
  return mocked
}

let useSpy: ReturnType<typeof vi.fn<(design: DesignNode) => void>>

describe('AIChatPanel 方案预览与留档（缺陷 1）', () => {
  beforeEach(() => {
    localStorage.clear()
    useSpy = vi.fn<(design: DesignNode) => void>()
    vi.stubGlobal('confirm', vi.fn(() => true))
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    localStorage.clear()
  })

  it('二选一阶段：两份方案各有缩略图、一句话定位，并给出 3~5 条关键差异', async () => {
    await explore()
    for (const i of [0, 1]) {
      expect(screen.getByTestId(`explore-thumb-${i}`)).toBeInTheDocument()
      expect(screen.getByTestId(`explore-positioning-${i}`).textContent).toBeTruthy()
      expect(screen.getByTestId(`explore-option-${i}`)).toHaveTextContent('兼容率')
    }
    const diffItems = screen.getByTestId('explore-diff').querySelectorAll('li')
    expect(diffItems.length - 1).toBeGreaterThanOrEqual(3) // 去掉标题行
    expect(diffItems.length - 1).toBeLessThanOrEqual(5)
    expect(screen.getByTestId('explore-diff')).toHaveTextContent('布局')
  })

  it('选用方案一：无二次确认（首次选定），出现已选档并写入留档', async () => {
    await explore()
    await userEvent.click(screen.getByTestId('explore-use-0'))

    expect(useSpy).toHaveBeenCalledTimes(1)
    expect(screen.queryByTestId('explore-result')).not.toBeInTheDocument()
    expect(screen.getByTestId('explore-archive-chosen')).toHaveTextContent('方案一')
    expect(loadExploreArchive()?.chosenIndex).toBe(0)
    expect(loadExploreArchive()?.options).toHaveLength(2) // 另一方案详情仍在留档里
  })

  it('已选档下查看另一方案：1 次点击可见完整详情，且不产生任何新请求', async () => {
    const { calls } = await explore()
    await userEvent.click(screen.getByTestId('explore-use-0'))
    const callsBefore = calls.length

    await userEvent.click(screen.getByTestId('explore-view-other'))
    expect(screen.getByTestId('explore-other-1')).toHaveTextContent('方案二')
    expect(screen.getByTestId('explore-other-thumb-1')).toBeInTheDocument() // 完整详情含缩略图
    expect(screen.getByTestId('explore-other-1')).toHaveTextContent('兼容率')
    expect(screen.getByTestId('explore-other-diff')).toHaveTextContent('布局')
    expect(calls.length).toBe(callsBefore) // 查看过程零模型调用
  })

  it('刷新后仍可还原选过的方案（留档从 localStorage 恢复）', async () => {
    const mocked = mockFetch(explorePayload())
    vi.stubGlobal('fetch', mocked.fetchMock)
    const panel = render(<AIChatPanel onGenerate={() => {}} onUseExploreDesign={useSpy} />)
    fireEvent.change(screen.getByTestId('chat-input'), { target: { value: '设计一个电商优惠券页' } })
    await userEvent.click(screen.getByTestId('explore-options'))
    await screen.findByTestId('explore-result')
    await userEvent.click(screen.getByTestId('explore-use-0'))
    expect(loadExploreArchive()?.chosenIndex).toBe(0)

    // 模拟刷新：卸载后以同一 scope 重新挂载，留档应从 localStorage 还原
    panel.unmount()
    render(<AIChatPanel onGenerate={() => {}} onUseExploreDesign={useSpy} />)
    await waitFor(() => expect(screen.getByTestId('explore-archive-chosen')).toHaveTextContent('方案一'))
    expect(screen.getByTestId('explore-archive')).toBeInTheDocument()
  })

  it('重新选择：先二次确认；取消则不覆盖，确认才改用并更新选定记录', async () => {
    await explore()
    await userEvent.click(screen.getByTestId('explore-use-0'))
    expect(useSpy).toHaveBeenCalledTimes(1)

    await userEvent.click(screen.getByTestId('explore-rechoose'))
    expect(screen.getByTestId('explore-rechoose-panel')).toBeInTheDocument()

    const confirmMock = vi.fn(() => false)
    vi.stubGlobal('confirm', confirmMock)
    await userEvent.click(screen.getByTestId('explore-rechoose-use-1'))
    expect(confirmMock).toHaveBeenCalledTimes(1)
    expect(useSpy).toHaveBeenCalledTimes(1) // 取消 → 不覆盖当前画布
    expect(loadExploreArchive()?.chosenIndex).toBe(0)

    vi.stubGlobal('confirm', vi.fn(() => true))
    await userEvent.click(screen.getByTestId('explore-rechoose-use-1'))
    expect(useSpy).toHaveBeenCalledTimes(2)
    expect(useSpy.mock.calls[1][0]).toMatchObject({ id: 'opt-dark-root' })
    expect(screen.getByTestId('explore-archive-chosen')).toHaveTextContent('方案二')
    expect(loadExploreArchive()?.chosenIndex).toBe(1)
  })

  it('降级方案与真实生成结果明确区分（不得混同）', async () => {
    await explore(
      explorePayload({
        degraded: true,
        options: [
          { label: '方案一 · 默认风格', design: LIGHT, template: 'login', compliance: 92, violations: 0, fallback: false },
          { label: '方案二 · 差异化风格', design: DARK, template: 'dashboard', compliance: 100, violations: 0, fallback: true },
        ],
      }),
    )
    expect(screen.getByTestId('explore-source-0')).toHaveAttribute('data-source', 'model')
    expect(screen.getByTestId('explore-source-0')).toHaveTextContent('AI 生成')
    expect(screen.getByTestId('explore-source-1')).toHaveAttribute('data-source', 'fallback')
    expect(screen.getByTestId('explore-source-1')).toHaveTextContent('已降级 · 预置模板')
    expect(screen.getByTestId('explore-degraded-notice')).toBeInTheDocument()

    // 选定降级方案后，留档里同样标注来源（刷新后不混同）
    await userEvent.click(screen.getByTestId('explore-use-1'))
    expect(screen.getByTestId('explore-archive-source')).toHaveAttribute('data-source', 'fallback')
  })

  it('关闭探索面板不影响已选留档', async () => {
    await explore()
    await userEvent.click(screen.getByTestId('explore-use-0'))
    await userEvent.click(screen.getByTestId('explore-options')) // 再探索一次
    await screen.findByTestId('explore-result')
    await userEvent.click(screen.getByTestId('explore-close'))
    expect(screen.queryByTestId('explore-result')).not.toBeInTheDocument()
    expect(screen.getByTestId('explore-archive')).toBeInTheDocument()
  })

  it('留档按 scope 分片：换设计会话看不到别的会话的选择记录', async () => {
    await explore()
    await userEvent.click(screen.getByTestId('explore-use-0'))
    expect(localStorage.getItem(exploreArchiveKey())).toBeTruthy()
    expect(localStorage.getItem(exploreArchiveKey('99'))).toBeNull()
  })
})
