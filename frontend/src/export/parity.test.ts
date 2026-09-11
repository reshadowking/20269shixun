/**
 * B0-2 导出语义 parity 测试（优化路线图 §3 B0-2）：
 * designToReactApp 与 designToHtml 两个通道对同一组件 fixture 输出一致的语义
 * （组件标记/关键文本/语义标签/样式键），作为 B1 导出收敛（ExportElement）的回归网。
 *
 * 已知差异登记：data-component 目前仅 React 通道输出；HTML 通道语义对齐放 B1
 * （ExportElement 统一序列化时两通道同源输出，届时把 HTML 侧断言升级为 data-component）。
 */
import { describe, expect, it } from 'vitest'

import type { ComponentType, DesignNode } from '@/design/types'
import { resolveColor } from '@/design/styleToCss'
import { CHART_COLORS } from '@/components/canvas/chart'
import { designToHtml } from './designToHtml'
import { designToReactApp } from './designToReact'

interface ComponentFixture {
  componentType: ComponentType
  props: Record<string, unknown>
  /** 两通道都应出现的关键文本（空串表示无文本组件，跳过文本断言） */
  text: string
  /** HTML 通道应有的语义标签（div/无语义组件可省略，以文本断言兜底） */
  htmlTag?: string
}

const FIXTURES: ComponentFixture[] = [
  { componentType: 'button', props: { text: '立即购买', variant: 'primary' }, text: '立即购买', htmlTag: 'button' },
  { componentType: 'card', props: { title: '卡片标题', content: '卡片内容' }, text: '卡片标题' },
  { componentType: 'input', props: { placeholder: '请输入邮箱', label: '邮箱' }, text: '请输入邮箱', htmlTag: 'input' },
  { componentType: 'select', props: { options: ['北京', '上海'] }, text: '北京', htmlTag: 'select' },
  { componentType: 'table', props: { columns: [{ key: 'a', title: '列A' }], rows: [{ a: '单元格值' }] }, text: '单元格值', htmlTag: 'table' },
  { componentType: 'chart', props: { chartType: 'bar', title: '月度趋势', data: [{ day: '一月', value: 30 }], xKey: 'day', yKey: 'value' }, text: '一月' },
  { componentType: 'stat-block', props: { label: '本月营收', value: '¥1.2万', trend: '↑12%' }, text: '本月营收' },
  { componentType: 'navbar', props: { title: '优选商城', links: [{ label: '首页', href: '#' }] }, text: '优选商城', htmlTag: 'nav' },
  { componentType: 'sidebar', props: { items: [{ label: '菜单一' }] }, text: '菜单一', htmlTag: 'aside' },
  { componentType: 'avatar', props: { name: '设计师' }, text: '设' },
  { componentType: 'tag', props: { text: '新品' }, text: '新品', htmlTag: 'span' },
  { componentType: 'divider', props: {}, text: '', htmlTag: 'hr' },
  { componentType: 'title-text', props: { text: '页面大标题', level: 2 }, text: '页面大标题', htmlTag: 'h2' },
  { componentType: 'hero', props: { title: '主视觉标题', subtitle: '副标题文案', cta: { text: '立即开始' } }, text: '主视觉标题', htmlTag: 'section' },
  { componentType: 'image', props: { src: 'https://cdn.example.com/a.png', alt: '示例图' }, text: '示例图', htmlTag: 'img' },
]

/** 每个组件挂在一个带样式的 frame 下（同时覆盖 frame 样式键 parity） */
function treeOf(f: ComponentFixture): DesignNode {
  return {
    id: 'root',
    type: 'frame',
    style: { layout: 'column', padding: 16, background: 'primary', gap: 8, width: 400, radius: 8 },
    children: [{ id: 'c1', type: 'component', componentType: f.componentType, props: f.props }],
  }
}

/** T5-0 专用树：无任何样式的纯净 frame（色彩断言不被根节点干扰） */
function plainTree(componentType: ComponentType, props: Record<string, unknown>): DesignNode {
  return {
    id: 'root',
    type: 'frame',
    style: { layout: 'column' },
    children: [{ id: 'c1', type: 'component', componentType, props }],
  }
}

describe('T5-0 #5 导出缺部件：button 变体底色', () => {
  const CASES = [
    ['primary', 'primary'],
    ['default', 'primary'],
    ['secondary', 'secondary'],
    ['destructive', 'danger'],
  ] as const

  it('填充类变体导出携带令牌底色与白字（双通道）', () => {
    for (const [variant, token] of CASES) {
      const react = designToReactApp(plainTree('button', { text: '去支付', variant }), false)
      const html = designToHtml(plainTree('button', { text: '去支付', variant }))
      const bg = resolveColor(token)
      expect(react, `${variant}: React 缺底色 ${bg}`).toContain(`"background":"${bg}"`)
      expect(react, `${variant}: React 缺白字`).toContain('"color":"#FFFFFF"')
      expect(html, `${variant}: HTML 缺底色 ${bg}`).toContain(`background: ${bg}`)
      expect(html, `${variant}: HTML 缺白字`).toContain('color: #FFFFFF')
    }
  })

  it('outline 携带令牌描边；ghost 无底色（防回退）', () => {
    const reactOutline = designToReactApp(plainTree('button', { text: '取消', variant: 'outline' }), false)
    expect(reactOutline).toContain(`"border":"1px solid ${resolveColor('border')}"`)
    const reactGhost = designToReactApp(plainTree('button', { text: '取消', variant: 'ghost' }), false)
    expect(reactGhost, 'ghost 不应有 background').not.toContain('"background"')
  })
})

describe('T5-0 #4 导出缺部件：sidebar active 态', () => {
  const SIDEBAR_PROPS = { items: [{ label: '首页' }, { label: '设置' }], active: '首页' }

  it('active 项 = primary 底 + 白字；非 active = text-light；根底色随画布（双通道）', () => {
    const react = designToReactApp(plainTree('sidebar', SIDEBAR_PROPS), false)
    const html = designToHtml(plainTree('sidebar', SIDEBAR_PROPS))
    // active：primary 底 + 白字（此前导出只有 padding，active 态整体丢失）
    expect(react).toContain(`"background":"${resolveColor('primary')}"`)
    expect(react).toContain('"color":"#FFFFFF"')
    expect(html).toContain(`background: ${resolveColor('primary')}`)
    expect(html).toContain('color: #FFFFFF')
    // 非 active：text-light 令牌灰（与画布 muted-foreground #86909c 同源）
    expect(react).toContain(`"color":"${resolveColor('text-light')}"`)
    expect(html).toContain(`color: ${resolveColor('text-light')}`)
    // 根底色：bg-foreground/95 → text-primary 令牌 95% 透明度（同文件同缺陷，一并收敛）
    const expectedRootBg = 'rgba(29,33,41,0.95)'
    expect(react).toContain(`"backgroundColor":"${expectedRootBg}"`)
    expect(html).toContain(`background-color: ${expectedRootBg}`)
  })
})

describe('T5-0 #2 导出缺部件：chart 多系列色', () => {
  const CHART_DATA_2 = [
    { day: '一月', value: 30 },
    { day: '二月', value: 60 },
  ]
  const CHART_DATA_5 = ['一', '二', '三', '四', '五'].map((day, i) => ({ day, value: (i + 1) * 10 }))

  it('CHART_COLORS 令牌化且与画布同源（前四色=令牌，第五色为文档化常量）', () => {
    expect(CHART_COLORS).toEqual([
      resolveColor('primary'),
      resolveColor('secondary'),
      resolveColor('success'),
      resolveColor('danger'),
      '#FF6B6B', // 令牌表无第 5 序列语义色，保留原值（画布/导出共用此常量）
    ])
  })

  it('bar/line 导出柱色 = 画布 fill（primary 令牌），旧错误色 #3D7FFF 不得回归', () => {
    for (const chartType of ['bar', 'line'] as const) {
      const react = designToReactApp(plainTree('chart', { chartType, title: '月度趋势', data: CHART_DATA_2, xKey: 'day', yKey: 'value' }), false)
      const html = designToHtml(plainTree('chart', { chartType, title: '月度趋势', data: CHART_DATA_2, xKey: 'day', yKey: 'value' }))
      expect(react, `${chartType}: React 柱色应为画布的 primary`).toContain(`"background":"${resolveColor('primary')}"`)
      expect(react, `${chartType}: React 混入旧错误色`).not.toContain('#3D7FFF')
      expect(html, `${chartType}: HTML 柱色应为画布的 primary`).toContain(`background: ${resolveColor('primary')}`)
      expect(html, `${chartType}: HTML 混入旧错误色`).not.toContain('#3D7FFF')
    }
  })

  it('pie 导出按序列循环取色（多系列色不再丢失）', () => {
    const react = designToReactApp(plainTree('chart', { chartType: 'pie', title: '占比', data: CHART_DATA_5, xKey: 'day', yKey: 'value' }), false)
    const html = designToHtml(plainTree('chart', { chartType: 'pie', title: '占比', data: CHART_DATA_5, xKey: 'day', yKey: 'value' }))
    for (const c of CHART_COLORS) {
      expect(react, `pie: React 缺序列色 ${c}`).toContain(`"background":"${c}"`)
      expect(html, `pie: HTML 缺序列色 ${c}`).toContain(`background: ${c}`)
    }
  })
})

describe('B0-2 导出语义 parity（React/HTML 双通道）', () => {
  it('15 组件：React 输出 data-component 标记，双通道保留关键文本与语义标签', () => {
    for (const f of FIXTURES) {
      const react = designToReactApp(treeOf(f), false)
      const html = designToHtml(treeOf(f))
      expect(react, `${f.componentType}: React 缺 data-component`).toContain(`data-component="${f.componentType}"`)
      if (f.text) {
        expect(react, `${f.componentType}: React 缺文本`).toContain(f.text)
        expect(html, `${f.componentType}: HTML 缺文本`).toContain(f.text)
      }
      if (f.htmlTag) {
        expect(html, `${f.componentType}: HTML 缺语义标签`).toMatch(new RegExp(`<${f.htmlTag}[\\s>]`))
      }
    }
  })

  it('frame 样式键双通道 parity（padding/令牌色/圆角都出现在两种产物）', () => {
    const react = designToReactApp(treeOf(FIXTURES[0]), false)
    const html = designToHtml(treeOf(FIXTURES[0]))
    // React：JSON 对象字面量形式
    expect(react).toContain('"padding":16')
    expect(react).toContain('"background":"#0052D9"') // primary 令牌解析
    expect(react).toContain('"borderRadius":8')
    // HTML：CSS 文本形式
    expect(html).toContain('padding: 16px')
    expect(html).toContain('background: #0052D9')
    expect(html).toContain('border-radius: 8px')
  })

  /**
   * T3 趋势色 parity（回归破洞：画布条件色「↑涨/否则跌」，导出曾恒为 success 绿，
   * 后台仪表板模板的 "↓ 2.4%" 导出后仍显示绿色）。锁死口径：趋势色两侧同源，
   * 涨 = success 令牌、跌 = danger 令牌（值取自 design-system.yaml 生成物，不写死 hex）。
   */
  it('stat-block 趋势色 parity：↑=success 令牌、↓=danger 令牌（React/HTML 双通道）', () => {
    const SUCCESS = resolveColor('success')
    const DANGER = resolveColor('danger')
    const treeOfTrend = (trend: string): DesignNode =>
      treeOf({ componentType: 'stat-block', props: { label: '本月营收', value: '¥1.2万', trend }, text: '本月营收' })

    for (const [trend, expected] of [
      ['↑12%', SUCCESS],
      ['↓ 2.4%', DANGER],
    ] as const) {
      const react = designToReactApp(treeOfTrend(trend), false)
      const html = designToHtml(treeOfTrend(trend))
      // 文本两通道都在（↓ 造数此前完全缺失）
      expect(react, `↑↓ ${trend}: React 缺趋势文本`).toContain(trend)
      expect(html, `↑↓ ${trend}: HTML 缺趋势文本`).toContain(trend)
      // 颜色：React 为 JSON 字面量形式，HTML 为 CSS 文本形式
      expect(react, `↑↓ ${trend}: React 趋势色非 ${expected}`).toContain(`"color":"${expected}"`)
      expect(html, `↑↓ ${trend}: HTML 趋势色非 ${expected}`).toContain(`color: ${expected}`)
      // 防回退：另一支颜色不得出现（fixture 无其他语义色用法，出现即趋势色又写死了）
      const other = expected === SUCCESS ? DANGER : SUCCESS
      expect(react, `↑↓ ${trend}: React 混入了对侧颜色`).not.toContain(`"color":"${other}"`)
      expect(html, `↑↓ ${trend}: HTML 混入了对侧颜色`).not.toContain(`color: ${other}`)
    }
  })
})
