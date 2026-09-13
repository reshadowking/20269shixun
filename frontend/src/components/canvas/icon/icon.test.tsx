/**
 * T9 icon 组件测试：
 * - 单一来源契约（shared/icon-library.json，三层手法与 backend/tests/test_icon_library.py 对称）；
 * - 画布渲染状态断言（内联值，jsdom 读不到 Tailwind 类）；
 * - 导出语义结构（attrs 只含 viewBox/d，描边类进 style——分通道契约）。
 * 静态组件说明：icon 无交互状态，画布选中态由选中框表达、不导出（任务卡 §4.1）。
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { DesignNode } from '@/design/types'
import { resolveColor } from '@/design/styleToCss'
import { CanvasIcon, buildIconExport, FALLBACK_ICON_NAME, iconSchema, ICON_LIBRARY, resolveIcon } from './index'

const SHARED_ICONS = JSON.parse(
  readFileSync(resolve(process.cwd(), '../shared/icon-library.json'), 'utf-8'),
) as { _comment: string; icons: Array<{ name: string; label: string; path: string }> }

const LIB = JSON.parse(
  readFileSync(resolve(process.cwd(), '../shared/component-library.json'), 'utf-8'),
) as { components: Array<{ type: string; props: Record<string, unknown> }> }

const starPath = () => SHARED_ICONS.icons.find((i) => i.name === 'star')!.path
const fallbackPath = () => SHARED_ICONS.icons.find((i) => i.name === FALLBACK_ICON_NAME)!.path

describe('icon 单一来源契约（shared/icon-library.json）', () => {
  it('① 前端加载结果 == JSON 文件（与后端 test_icon_library 对称，两端同读一份文件）', () => {
    expect(ICON_LIBRARY).toEqual(SHARED_ICONS)
  })

  it('② 假图标生效：追加假图标 → 查表/属性面板下拉即时可见（证明"读取"非"抄写"）', () => {
    ICON_LIBRARY.icons.push({ name: '测试假图标', label: '假', path: 'M0 0' })
    try {
      expect(resolveIcon('测试假图标').name).toBe('测试假图标')
      expect(iconSchema[0].options).toContain('测试假图标')
    } finally {
      ICON_LIBRARY.icons.pop()
    }
    expect(resolveIcon('测试假图标').name).toBe(FALLBACK_ICON_NAME)
  })

  it('③ 名字集合与文件一致且唯一；面板下拉选项现算自 ICON_LIBRARY（不许硬编码清单）', () => {
    const names = SHARED_ICONS.icons.map((i) => i.name)
    expect(new Set(names).size).toBe(names.length)
    expect(iconSchema[0].options).toEqual(names)
  })
})

describe('icon 画布渲染（内联值断言）', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('span > svg > path：viewBox 24、d 来自库、stroke currentColor / fill none / strokeWidth 2 内联', () => {
    const { container } = render(<CanvasIcon props={{ name: 'star', color: 'primary', size: 'default' }} />)
    const span = container.firstElementChild as HTMLElement
    const svg = container.querySelector('svg')!
    const path = container.querySelector('path')!
    expect(svg.getAttribute('viewBox')).toBe('0 0 24 24')
    expect(path.getAttribute('d')).toBe(starPath())
    // jsdom 把 CSS 关键词规范成全小写（currentcolor），浏览器同样大小写不敏感
    expect(svg.style.stroke.toLowerCase()).toBe('currentcolor')
    expect(svg.style.fill).toBe('none')
    // React 将 strokeWidth 视为无单位属性（画布/导出 React 通道均为数字 2；
    // HTML 通道才 kebab 化 + px —— 等价断言见 parity.test.ts，SVG 里 2 与 2px 同义）
    expect(svg.style.strokeWidth).toBe('2')
    expect(svg.style.strokeLinecap).toBe('round')
    expect(svg.style.strokeLinejoin).toBe('round')
    expect(svg.getAttribute('width')).toBe('20')
    expect(svg.getAttribute('height')).toBe('20')
    expect(span.style.display).toBe('inline-flex')  })

  it('color 令牌经 resolveColor 内联在 span（描边用 currentColor，换令牌只改一处）', () => {
    const { container } = render(<CanvasIcon props={{ name: 'star', color: 'primary' }} />)
    const span = container.firstElementChild as HTMLElement
    expect(span.style.color).toBe(`rgb(${hexToRgb(resolveColor('primary')!)})`)
  })

  it('size 三档 → 16/20/24px', () => {
    const sizes: Array<[string, string]> = [['sm', '16'], ['default', '20'], ['lg', '24']]
    for (const [size, px] of sizes) {
      const { container, unmount } = render(<CanvasIcon props={{ name: 'star', size }} />)
      expect(container.querySelector('svg')?.getAttribute('width')).toBe(px)
      unmount()
    }
  })

  it('未知 name：兜底渲染 help-circle 路径 + console.warn，不抛错（渲染层唯一防线）', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { container } = render(<CanvasIcon props={{ name: '不存在的图标' }} />)
    expect(container.querySelector('path')?.getAttribute('d')).toBe(fallbackPath())
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('name 缺省 → star（组件库 default，与后端提示词口径一致）；缺省不触发 warn', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { container } = render(<CanvasIcon props={{}} />)
    expect(container.querySelector('path')?.getAttribute('d')).toBe(starPath())
    expect(warn).not.toHaveBeenCalled()
  })
})

describe('icon 导出语义与属性面板', () => {
  it('buildIconExport：span > svg > path 同构；attrs 只含 viewBox/d（描边类进 style，分通道契约）', () => {
    const node: DesignNode = { id: 'i', type: 'component', componentType: 'icon', props: { name: 'star', color: 'primary', size: 'lg' } }
    const el = buildIconExport(node)
    expect(el.tag).toBe('span')
    expect(el.attrs).toEqual({})
    expect(el.style.color).toBe(resolveColor('primary'))
    const svg = el.children![0]
    expect(svg.tag).toBe('svg')
    expect(svg.attrs).toEqual({ viewBox: '0 0 24 24' })
    expect(svg.style).toMatchObject({ stroke: 'currentColor', fill: 'none', strokeWidth: 2, width: 24, height: 24 })
    const path = svg.children![0]
    expect(path.tag).toBe('path')
    expect(path.attrs).toEqual({ d: starPath() })
  })

  it('未知 name 导出走兜底占位（与画布同源）', () => {
    const node: DesignNode = { id: 'i', type: 'component', componentType: 'icon', props: { name: '不存在' } }
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const el = buildIconExport(node)
    expect(el.children![0].children![0].attrs.d).toBe(fallbackPath())
    expect(warn).toHaveBeenCalled()
  })

  it('属性面板字段数与组件库声明一致（§7 字段数量不膨胀）', () => {
    const libProps = LIB.components.find((c) => c.type === 'icon')!.props
    expect(iconSchema.map((f) => f.key).sort()).toEqual(Object.keys(libProps).sort())
    expect(iconSchema).toHaveLength(3)
  })
})

/** 令牌 hex → jsdom 内联样式 rgb(...) 形式 */
function hexToRgb(hex: string): string {
  const n = parseInt(hex.slice(1), 16)
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`
}
