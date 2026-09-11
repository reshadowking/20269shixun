/**
 * 图片导出内联（ADR-008 / 缺口 P0-1）回归测试。
 *
 * 覆盖：① 收集逻辑（只收平台内部路径、去重、递归）；② 读取失败不抛错；
 *      ③ 导出引擎在传入 assets 时替换 src，不传时行为不变（向后兼容）。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { DesignNode } from '@/design/types'
import { designToHtml } from './designToHtml'
import { designToReactApp } from './designToReact'
import { collectImageSrcs, loadInlineAssets } from './inlineAssets'

const DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg=='

function design(): DesignNode {
  return {
    id: 'root',
    type: 'frame',
    children: [
      { id: 'img1', type: 'component', componentType: 'image', props: { src: '/api/images/1', alt: '一' } },
      {
        id: 'box',
        type: 'frame',
        children: [
          { id: 'img2', type: 'component', componentType: 'image', props: { src: '/api/images/2' } },
          { id: 'dup', type: 'component', componentType: 'image', props: { src: '/api/images/1' } },
        ],
      },
      { id: 'ext', type: 'component', componentType: 'image', props: { src: 'https://cdn.example.com/a.png' } },
      { id: 'none', type: 'component', componentType: 'image', props: {} },
    ],
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('collectImageSrcs', () => {
  it('递归收集平台内部图片路径，去重且保持顺序', () => {
    expect(collectImageSrcs(design())).toEqual(['/api/images/1', '/api/images/2'])
  })

  it('外链与空 src 不收集（外链由对方托管）', () => {
    const srcs = collectImageSrcs(design())
    expect(srcs).not.toContain('https://cdn.example.com/a.png')
    expect(srcs).not.toContain('')
  })

  it('没有图片时返回空数组', () => {
    expect(collectImageSrcs({ id: 'r', type: 'frame', children: [{ id: 't', type: 'text' }] })).toEqual([])
  })
})

describe('loadInlineAssets', () => {
  function mockFetchOk() {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, blob: async () => new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }) })),
    )
  }

  it('成功时产出 dataURL 映射', async () => {
    mockFetchOk()
    const { assets, failed } = await loadInlineAssets(['/api/images/1'])
    expect(failed).toEqual([])
    expect(assets['/api/images/1']).toMatch(/^data:image\/png;base64,/)
  })

  it('单张失败不抛错，记入 failed（不静默产出破图）', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404 })))
    const { assets, failed } = await loadInlineAssets(['/api/images/9'])
    expect(assets).toEqual({})
    expect(failed).toEqual(['/api/images/9'])
  })

  it('fetch 抛错时同样降级为 failed', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network') }))
    const { assets, failed } = await loadInlineAssets(['/api/images/err'])
    expect(assets).toEqual({})
    expect(failed).toEqual(['/api/images/err'])
  })
})

describe('导出引擎：src 内联替换', () => {
  const assets = { '/api/images/1': DATA_URL, '/api/images/2': DATA_URL }

  it('designToReactApp 传入 assets 时把 /api/images/* 替换为 dataURL', () => {
    const code = designToReactApp(design(), false, assets)
    expect(code).toContain(DATA_URL)
    expect(code).not.toContain('/api/images/1')
    expect(code).not.toContain('/api/images/2')
    // 外链保持原样
    expect(code).toContain('https://cdn.example.com/a.png')
  })

  it('designToReactApp 不传 assets 时行为不变（向后兼容回归）', () => {
    const code = designToReactApp(design(), false)
    expect(code).toContain('/api/images/1')
    expect(code).not.toContain(DATA_URL)
  })

  it('designToHtml 同样支持内联（preview.html 离线可看图）', () => {
    const html = designToHtml(design(), assets)
    expect(html).toContain(DATA_URL)
    expect(html).not.toContain('/api/images/1')
    expect(designToHtml(design())).toContain('/api/images/1')
  })
})
