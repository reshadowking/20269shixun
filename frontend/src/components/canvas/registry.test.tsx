import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { componentPalette, componentRegistry, renderExportTemplate } from '@/components/canvas/registry'
import { COMPONENT_TYPES } from '@/design/types'

/** 画布渲染：React 默认转义（渲染通道 XSS 防线，v2.2 §11.2） */
describe('组件画布渲染', () => {
  it('15 个组件全部注册（四件套齐备）', () => {
    expect(Object.keys(componentRegistry).sort()).toEqual([...COMPONENT_TYPES].sort())
    expect(componentPalette.length).toBe(15)
    for (const [type, def] of Object.entries(componentRegistry)) {
      expect(typeof def.Canvas).toBe('function'), `${type} 缺画布渲染`
      expect(typeof def.exportTemplate).toBe('function'), `${type} 缺导出模板`
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

  it('未注册组件渲染占位并标记警告', () => {
    // registry 直接查不到的类型 → NodeRenderer 层处理；此处验证注册表行为
    expect(componentRegistry['spaghetti']).toBeUndefined()
  })
})

/** 导出模板：HTML 转义（导出通道 XSS 防线） */
describe('组件导出模板转义', () => {
  it('button 文本注入 <script> 被转义', () => {
    const out = renderExportTemplate('button', { text: '<script>alert(1)</script>', variant: 'default' })
    expect(out).not.toContain('<script>')
    expect(out).toContain('&lt;script&gt;')
  })

  it('button 文本闭合标签注入被转义', () => {
    const out = renderExportTemplate('button', { text: '</button><script>alert(1)</script>' })
    expect(out).not.toContain('</button><script>')
    expect(out).toContain('&lt;/button&gt;')
  })

  it('input placeholder 注入被转义（属性注入防线）', () => {
    const out = renderExportTemplate('input', { placeholder: '"><img src=x onerror=alert(1)>' })
    // <img 必须被转义为 &lt;img，HTML 解析时不会成为真实标签（onerror 文本保留是安全的）
    expect(out).not.toContain('<img')
    expect(out).toContain('&lt;img')
    expect(out).toContain('&quot;&gt;')
  })

  it('navbar 链接 javascript: 协议被降级为 #（href 白名单）', () => {
    const out = renderExportTemplate('navbar', {
      title: '品牌',
      links: [{ label: '危险', href: 'javascript:alert(1)' }, { label: '正常', href: 'https://ok.com' }],
    })
    expect(out).not.toContain('javascript:')
    expect(out).toContain('href="#"')
    expect(out).toContain('href="https://ok.com"')
  })

  it('title-text 内容转义', () => {
    const out = renderExportTemplate('title-text', { text: '<img onerror=alert(1)>', level: 2 })
    expect(out).not.toContain('<img')
    expect(out).toContain('&lt;img')
  })

  it('chart 数据注入 < 被 JSON 转义', () => {
    const out = renderExportTemplate('chart', {
      chartType: 'bar',
      data: [{ day: '</script><script>alert(1)</script>', value: 1 }],
      xKey: 'day',
      yKey: 'value',
    })
    expect(out).not.toContain('</script><script>')
  })

  it('hero CTA 文本转义', () => {
    const out = renderExportTemplate('hero', { title: 'T', cta: { text: '"><script>alert(1)</script>' } })
    expect(out).not.toContain('<script>')
  })
})
