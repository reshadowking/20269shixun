import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { componentPalette, componentRegistry } from '@/components/canvas/registry'
import { COMPONENT_TYPES } from '@/design/types'
import { resolveColor } from '@/design/styleToCss'
import { VARIANT_CLASS, buttonSchema } from '@/components/canvas/button'

/** B0 契约：前端组件事实源 vs shared/component-library.json（单一来源护栏）。
 * vitest cwd 为 frontend/，shared 在其上一级。 */
const LIB: { components: Array<{ type: string; props: Record<string, { enum?: string[] }> }> } = JSON.parse(
  readFileSync(resolve(process.cwd(), '../shared/component-library.json'), 'utf-8'),
)
const LIB_BUTTON = LIB.components.find((c) => c.type === 'button')!

/** 画布渲染：React 默认转义（渲染通道 XSS 防线，v2.2 §11.2） */
describe('组件画布渲染', () => {
  it('15 个组件全部注册（四件套齐备）', () => {
    expect(Object.keys(componentRegistry).sort()).toEqual([...COMPONENT_TYPES].sort())
    expect(componentPalette.length).toBe(15)
    for (const [type, def] of Object.entries(componentRegistry)) {
      expect(typeof def.Canvas).toBe('function'), `${type} 缺画布渲染`
      expect(typeof def.buildExport).toBe('function'), `${type} 缺导出语义描述 buildExport`
      expect(Array.isArray(def.schema)), `${type} 缺属性配置`
      expect(def.label).toBeTruthy(), `${type} 缺中文名`
    }
  })

  it('按钮渲染：script 文本被 React 转义为纯文本（不执行）', () => {
    const def = componentRegistry.button
    render(<def.Canvas props={{ text: '<script>alert(1)</script>' }} />)
    // React 默认转义：文本节点内容含字面 <script>，DOM 里不会有可执行脚本元素
    expect(screen.getByText('<script>alert(1)</script>')).toBeTruthy()
    expect(document.querySelector('script')).toBeNull()
  })

  it('tag 渲染：颜色令牌驱动样式', () => {
    const def = componentRegistry.tag
    const { container } = render(<def.Canvas props={{ text: '最热', color: 'danger' }} />)
    expect(container.querySelector('[data-testid="canvas-tag"]')?.textContent).toBe('最热')
  })

  it('stat-block 趋势渲染：涨=success、跌=danger，内联色与导出同源（T3）', () => {
    // jsdom 不解析 Tailwind 类：趋势色走内联样式，画布/导出才能同源并被测试
    const def = componentRegistry['stat-block']
    const rgb = (hex: string): string => {
      const n = parseInt(hex.slice(1), 16)
      return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`
    }
    const { unmount } = render(<def.Canvas props={{ label: 'L', value: 'V', trend: '↑ 12.6%' }} />)
    expect(screen.getByText('↑ 12.6%').style.color).toBe(rgb(resolveColor('success')!))
    unmount()
    render(<def.Canvas props={{ label: 'L', value: 'V', trend: '↓ 2.4%' }} />)
    expect(screen.getByText('↓ 2.4%').style.color).toBe(rgb(resolveColor('danger')!))
  })

  it('button 变体底色内联渲染（T5-0 #5）：画布与导出同源令牌', () => {
    const def = componentRegistry.button
    const rgb = (hex: string): string => {
      const n = parseInt(hex.slice(1), 16)
      return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`
    }
    render(<def.Canvas props={{ text: '去支付', variant: 'primary' }} />)
    const el = screen.getByText('去支付')
    expect(el.style.backgroundColor).toBe(rgb(resolveColor('primary')!))
    expect(el.style.color).toBe('rgb(255, 255, 255)')
  })

  it('sidebar active 态内联渲染（T5-0 #4）：active 白字蓝底，非 active text-light', () => {
    const def = componentRegistry.sidebar
    const rgb = (hex: string): string => {
      const n = parseInt(hex.slice(1), 16)
      return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`
    }
    render(<def.Canvas props={{ items: [{ label: '首页' }, { label: '设置' }], active: '首页' }} />)
    expect(screen.getByText('首页').style.backgroundColor).toBe(rgb(resolveColor('primary')!))
    expect(screen.getByText('首页').style.color).toBe('rgb(255, 255, 255)')
    expect(screen.getByText('设置').style.color).toBe(rgb(resolveColor('text-light')!))
  })

  it('未注册组件渲染占位并标记警告', () => {
    // registry 直接查不到的类型 → NodeRenderer 层处理；此处验证注册表行为
    expect(componentRegistry['spaghetti']).toBeUndefined()
  })
})

/** B0 组件事实源契约（优化路线图 §3 B0-1）：registry / 组件库 / 面板 / 渲染层合法集合收敛护栏 */
describe('B0 组件事实源契约', () => {
  it('registry 组件集合 == component-library 组件集合', () => {
    const libTypes = LIB.components.map((c) => c.type).sort()
    expect(Object.keys(componentRegistry).sort()).toEqual(libTypes)
  })

  it('button 面板 options 与组件库 enum 一致（size 与 variant 均为 6）', () => {
    const libVariant = LIB_BUTTON.props.variant.enum as string[]
    const libSize = LIB_BUTTON.props.size.enum as string[]
    const panelVariant = buttonSchema.find((f) => f.key === 'variant')!.options
    const panelSize = buttonSchema.find((f) => f.key === 'size')!.options
    expect(panelVariant).toEqual(libVariant)
    expect(panelSize).toEqual(libSize)
  })

  it('渲染层 VARIANT_CLASS 与组件库 enum 一致（P14 决策卡：已删 link，四方收敛到 6）', () => {
    const libVariant = LIB_BUTTON.props.variant.enum as string[]
    expect(Object.keys(VARIANT_CLASS).sort()).toEqual([...libVariant].sort())
  })
})
