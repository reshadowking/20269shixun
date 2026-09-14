/**
 * B0-2 导出语义 parity 测试（优化路线图 §3 B0-2）：
 * designToReactApp 与 designToHtml 两个通道对同一组件 fixture 输出一致的语义
 * （组件标记/关键文本/语义标签/样式键），作为 B1 导出收敛（ExportElement）的回归网。
 *
 * 已知差异登记：data-component 目前仅 React 通道输出；HTML 通道语义对齐放 B1
 * （ExportElement 统一序列化时两通道同源输出，届时把 HTML 侧断言升级为 data-component）。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import type { ComponentType, DesignNode } from '@/design/types'
import { resolveColor } from '@/design/styleToCss'
import { CHART_COLORS } from '@/components/canvas/styleTokens'
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
  { componentType: 'icon', props: { name: 'star', color: 'primary', size: 'default' }, text: '', htmlTag: 'span' },
  { componentType: 'switch', props: { label: '接收通知', checked: true }, text: '接收通知', htmlTag: 'div' },
  { componentType: 'tabs', props: { items: [{ label: '标签一' }, { label: '标签二' }], active: 1 }, text: '标签一', htmlTag: 'div' },
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

describe('B0-2 导出语义 parity（React/HTML 双通道）', () => {  it('15 组件：React 输出 data-component 标记，双通道保留关键文本与语义标签', () => {
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

/** 令牌 hex → rgb 通道（rgba 拼装用，与 styleTokens 的派生方式一致） */
function rgbaChannels(hex: string): string {
  const n = parseInt(hex.slice(1), 16)
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`
}

describe('T5 批A #6 input 标签色（口径：以画布为准 → text-primary）', () => {
  const INPUT_PROPS = { label: '邮箱', placeholder: '请输入邮箱' }

  it('label 色双通道 = text-primary 令牌', () => {
    const react = designToReactApp(plainTree('input', INPUT_PROPS), false)
    const html = designToHtml(plainTree('input', INPUT_PROPS))
    const PRIMARY = resolveColor('text-primary')!
    expect(react, 'React label 应为主文本色').toContain(`"color":"${PRIMARY}"`)
    expect(html, 'HTML label 应为主文本色').toContain(`color: ${PRIMARY}`)
  })

  it('防回退：旧导出次级灰 #4E5969 不得作为 label 色回归', () => {
    const react = designToReactApp(plainTree('input', INPUT_PROPS), false)
    const html = designToHtml(plainTree('input', INPUT_PROPS))
    expect(react, 'React 旧 label 色 #4E5969 不得回归').not.toContain('#4E5969')
    expect(html, 'HTML 旧 label 色 #4E5969 不得回归').not.toContain('#4E5969')
  })
})

describe('T5 批A #8 navbar 链接色（导出补 text-light；hover 为交互态不导出）', () => {
  const NAV_PROPS = { title: '优选商城', links: [{ label: '首页', href: '#' }] }

  it('链接色双通道 = text-light 令牌（此前导出无 color 继承黑）', () => {
    const react = designToReactApp(plainTree('navbar', NAV_PROPS), false)
    const html = designToHtml(plainTree('navbar', NAV_PROPS))
    const LIGHT = resolveColor('text-light')!
    expect(react, 'React 链接应有 text-light 色').toContain(`"color":"${LIGHT}"`)
    expect(html, 'HTML 链接应有 text-light 色').toContain(`color: ${LIGHT}`)
  })
})

describe('T5 批A #9 table（border 令牌 + 表头底色/表头文字收敛）', () => {
  const TABLE_PROPS = { columns: [{ key: 'a', title: '列A' }], rows: [{ a: '单元格值' }] }

  it('单元格边框双通道 = border 令牌（值与旧硬编码相等，来源收敛）', () => {
    const react = designToReactApp(plainTree('table', TABLE_PROPS), false)
    const html = designToHtml(plainTree('table', TABLE_PROPS))
    const BORDER = `1px solid ${resolveColor('border')!}`
    expect(react, 'React 单元格边框应为 border 令牌').toContain(`"border":"${BORDER}"`)
    expect(html, 'HTML 单元格边框应为 border 令牌').toContain(`border: ${BORDER}`)
  })

  it('表头底色（background 令牌 50% 透明）与表头文字（text-light）双通道——此前导出整体缺失', () => {
    const react = designToReactApp(plainTree('table', TABLE_PROPS), false)
    const html = designToHtml(plainTree('table', TABLE_PROPS))
    const HEAD_BG = `rgba(${rgbaChannels(resolveColor('background')!)}, 0.5)`
    const LIGHT = resolveColor('text-light')!
    expect(react, 'React 表头应有底色').toContain(`"background":"${HEAD_BG}"`)
    expect(html, 'HTML 表头应有底色').toContain(`background: ${HEAD_BG}`)
    expect(react, 'React 表头文字应为 text-light').toContain(`"color":"${LIGHT}"`)
    expect(html, 'HTML 表头文字应为 text-light').toContain(`color: ${LIGHT}`)
  })
})

describe('T5 批A #3/#7 值等来源分叉项（导出侧与令牌同值的 green-lock）', () => {
  it('#3 chart 导出轴标签 = text-light（画布 tick 同步收敛由 registry 断言）', () => {
    const CHART_PROPS = { chartType: 'bar', title: '月度趋势', data: [{ day: '一月', value: 30 }], xKey: 'day', yKey: 'value' }
    const react = designToReactApp(plainTree('chart', CHART_PROPS), false)
    const html = designToHtml(plainTree('chart', CHART_PROPS))
    const LIGHT = resolveColor('text-light')!
    expect(react, 'React 轴标签应为 text-light').toContain(`"color":"${LIGHT}"`)
    expect(html, 'HTML 轴标签应为 text-light').toContain(`color: ${LIGHT}`)
  })

  it('#7 stat-block 导出 label = text-light', () => {
    const react = designToReactApp(plainTree('stat-block', { label: '本月营收', value: '¥1.2万' }), false)
    const html = designToHtml(plainTree('stat-block', { label: '本月营收', value: '¥1.2万' }))
    const LIGHT = resolveColor('text-light')!
    expect(react, 'React stat label 应为 text-light').toContain(`"color":"${LIGHT}"`)
    expect(html, 'HTML stat label 应为 text-light').toContain(`color: ${LIGHT}`)
  })
})

describe('T5 批B 四件套状态与默认观感（导出侧双通道）', () => {
  it('button disabled：attrs disabled + opacity 0.5（§4.2.5 决策 a：补齐）', () => {
    const react = designToReactApp(plainTree('button', { text: '去支付', disabled: true }), false)
    const html = designToHtml(plainTree('button', { text: '去支付', disabled: true }))
    expect(react, 'React 缺 disabled 属性').toContain('disabled="disabled"')
    expect(react, 'React 缺 disabled opacity').toContain('"opacity":0.5')
    expect(html, 'HTML 缺 disabled 属性').toContain('disabled="disabled"')
    expect(html, 'HTML 缺 disabled opacity').toContain('opacity: 0.5')
    // 未禁用：不输出 disabled 与 opacity
    const reactOn = designToReactApp(plainTree('button', { text: '去支付' }), false)
    expect(reactOn).not.toContain('disabled=')
    expect(reactOn).not.toContain('"opacity"')
  })

  it('input 默认观感：控件边框/圆角/高度内联（此前导出裸 input），disabled 带 opacity', () => {
    const react = designToReactApp(plainTree('input', { label: '邮箱', placeholder: '请输入邮箱' }), false)
    const html = designToHtml(plainTree('input', { label: '邮箱', placeholder: '请输入邮箱' }))
    const BORDER = `1px solid ${resolveColor('border')!}`
    expect(react, 'React 缺控件边框').toContain(`"border":"${BORDER}"`)
    expect(react, 'React 缺控件高度').toContain('"height":40')
    expect(html, 'HTML 缺控件边框').toContain(`border: ${BORDER}`)
    const reactDis = designToReactApp(plainTree('input', { placeholder: 'x', disabled: true }), false)
    expect(reactDis, 'React 缺 disabled opacity').toContain('"opacity":0.5')
    expect(reactDis, 'React 缺 disabled 属性').toContain('disabled="disabled"')
  })

  it('select 默认观感：与 input 同一套控件边框/圆角/高度', () => {
    const react = designToReactApp(plainTree('select', { options: ['北京'] }), false)
    const html = designToHtml(plainTree('select', { options: ['北京'] }))
    const BORDER = `1px solid ${resolveColor('border')!}`
    expect(react, 'React 缺控件边框').toContain(`"border":"${BORDER}"`)
    expect(html, 'HTML 缺控件边框').toContain(`border: ${BORDER}`)
  })

  it('card 默认观感：padding/border/圆角/阴影双通道（此前导出裸 div），title/content 字号与画布一致', () => {
    const react = designToReactApp(plainTree('card', { title: '卡片标题', content: '卡片内容' }), false)
    const html = designToHtml(plainTree('card', { title: '卡片标题', content: '卡片内容' }))
    const BORDER = `1px solid ${resolveColor('border')!}`
    expect(react, 'React 缺卡片 padding').toContain('"padding":24')
    expect(react, 'React 缺卡片边框').toContain(`"border":"${BORDER}"`)
    expect(react, 'React 缺卡片圆角').toContain('"borderRadius":8')
    expect(react, 'React 缺卡片阴影').toContain('"boxShadow":"0 1px 2px rgba(29,33,41,0.06)"')
    expect(html, 'HTML 缺卡片 padding').toContain('padding: 24px')
    expect(html, 'HTML 缺卡片阴影').toContain('box-shadow: 0 1px 2px rgba(29,33,41,0.06)')
    // title/content 与画布 text-lg font-semibold / text-sm muted 对齐
    expect(react, 'React 卡片标题应为 18/600').toContain('"fontSize":18')
    expect(react, 'React 卡片内容应为 text-light 色').toContain(`"color":"${resolveColor('text-light')!}"`)
    expect(html, 'HTML 卡片标题应为 18px').toContain('font-size: 18px')
  })

  it('hover/active/focus 为交互态：静态 HTML 导出不实现（有注释说明，非遗漏）——此断言锁「不静默缺失」', () => {
    // navbar 批A 已示范：交互态在导出侧注释写明。这里断言 HTML 产物不含伪 hover 实现
    // （若未来有人往 style 里塞 hover 相关声明，此处会红，提示改走注释说明路径）。
    const html = designToHtml(plainTree('button', { text: '去支付' }))
    expect(html).not.toContain(':hover')
    expect(html).not.toContain('brightness')
  })
})

describe('T5.5 #12 button 静态样式导出（与画布内联值一致）', () => {
  it('圆角 6/阴影极轻/字号 14/字重 500/高度 40/左右内边距 16 双通道', () => {
    const react = designToReactApp(plainTree('button', { text: '去支付' }), false)
    const html = designToHtml(plainTree('button', { text: '去支付' }))
    expect(react, 'React 缺圆角').toContain('"borderRadius":6')
    expect(react, 'React 缺阴影').toContain('"boxShadow":"0 1px 2px rgba(29,33,41,0.06)"')
    expect(react, 'React 缺字号').toContain('"fontSize":14')
    expect(react, 'React 缺字重').toContain('"fontWeight":500')
    expect(react, 'React 缺高度').toContain('"height":40')
    expect(react, 'React 缺左右内边距').toContain('"paddingLeft":16')
    expect(html, 'HTML 缺圆角').toContain('border-radius: 6px')
    expect(html, 'HTML 缺阴影').toContain('box-shadow: 0 1px 2px rgba(29,33,41,0.06)')
    expect(html, 'HTML 缺字号').toContain('font-size: 14px')
    expect(html, 'HTML 缺字重').toContain('font-weight: 500;')
    expect(html, 'HTML 缺高度').toContain('height: 40px')
  })

  it('防回退：button 导出不得无圆角（修复前形态）', () => {
    const html = designToHtml(plainTree('button', { text: '去支付' }))
    expect(html).toContain('border-radius')
  })
})

describe('T5.5 #11 card 底色/文字色导出（不再透明）', () => {
  it('background 白 + color 主文本双通道', () => {
    const react = designToReactApp(plainTree('card', { title: '卡片标题', content: '卡片内容' }), false)
    const html = designToHtml(plainTree('card', { title: '卡片标题', content: '卡片内容' }))
    expect(react, 'React 缺卡片白底').toContain('"background":"#FFFFFF"')
    expect(html, 'HTML 缺卡片白底').toContain('background: #FFFFFF')
    expect(react, 'React 缺主文本色').toContain(`"color":"${resolveColor('text-primary')!}"`)
    expect(html, 'HTML 缺主文本色').toContain(`color: ${resolveColor('text-primary')!}`)
  })
})

describe('T5.5 §4.7 HTML 通道无单位数值属性（双通道数值一致性）', () => {
  it('禁用 button：两通道 opacity 等值 0.5，HTML 不得出现 0.5px（假安心断言修正）', () => {
    const react = designToReactApp(plainTree('button', { text: '去支付', disabled: true }), false)
    const html = designToHtml(plainTree('button', { text: '去支付', disabled: true }))
    expect(react).toContain('"opacity":0.5')
    expect(html, 'HTML opacity 应为无单位 0.5').toContain('opacity: 0.5;')
    expect(html, 'HTML 不得把 opacity 加 px').not.toContain('0.5px')
  })

  it('font-weight 600 不加 px（卡片标题）', () => {
    const html = designToHtml(plainTree('card', { title: '卡片标题', content: '卡片内容' }), )
    expect(html, 'HTML font-weight 应为无单位 600').toContain('font-weight: 600;')
    expect(html).not.toContain('600px')
  })

  it('flex 1 不加 px（chart 导出柱）', () => {
    const html = designToHtml(plainTree('chart', { chartType: 'bar', data: [{ day: '一月', value: 30 }], xKey: 'day', yKey: 'value' }))
    expect(html, 'HTML flex 应为无单位 1').toContain('flex: 1;')
    expect(html).not.toContain('flex: 1px')
  })
})

describe('T5.6 ghost 变体阴影（导出侧）', () => {
  it('ghost 导出无 boxShadow（防回归）；填充变体仍有', () => {
    const reactGhost = designToReactApp(plainTree('button', { text: '取消', variant: 'ghost' }), false)
    expect(reactGhost, 'ghost 导出不应有 boxShadow').not.toContain('"boxShadow"')
    const reactPrimary = designToReactApp(plainTree('button', { text: '去支付', variant: 'primary' }), false)
    expect(reactPrimary).toContain('"boxShadow":"0 1px 2px rgba(29,33,41,0.06)"')
  })
})

describe('T9 icon parity（lucide 数据内联，span > svg > path 双通道同构）', () => {
  const STAR_PATH = (JSON.parse(readFileSync(resolve(process.cwd(), '../shared/icon-library.json'), 'utf-8')) as { icons: Array<{ name: string; path: string }> })
    .icons.find((i) => i.name === 'star')!.path

  it('span/svg/path 同构：viewBox 与 d 走 attrs（双通道拼写一致），关键文本断言用无文本组件兜底', () => {
    const react = designToReactApp(plainTree('icon', { name: 'star', color: 'primary', size: 'default' }), false)
    const html = designToHtml(plainTree('icon', { name: 'star', color: 'primary', size: 'default' }))
    expect(react).toContain('data-component="icon"')
    // 序列化器 style 在 attrs 前，svg 标签与 viewBox 分开断言（两通道同序）
    expect(react).toContain('<svg')
    expect(react).toContain('viewBox="0 0 24 24"')
    expect(react).toContain(`d="${STAR_PATH}"`)
    expect(html).toContain('<svg')
    expect(html).toContain('viewBox="0 0 24 24"')
    expect(html).toContain(`d="${STAR_PATH}"`)
  })

  it('SVG 属性分通道：strokeWidth 是数字——React 通道 2（无单位）、HTML 通道 2px（等价断言，差异有意保留）', () => {
    const react = designToReactApp(plainTree('icon', { name: 'star' }), false)
    const html = designToHtml(plainTree('icon', { name: 'star' }))
    expect(react, 'React 缺 strokeWidth').toContain('"strokeWidth":2')
    expect(react, 'React strokeWidth 不得序列化为字符串 px 值').not.toContain('"strokeWidth":"2px"')
    expect(html, 'HTML 缺 stroke-width').toContain('stroke-width: 2px')
    // 反断言（T5.5 §4.7 教训）：数值属性不得以无单位形态出现在 HTML 通道
    expect(html, 'HTML stroke-width 不得丢 px').not.toContain('stroke-width: 2;')
    expect(react).toContain('"stroke":"currentColor"')
    expect(html).toContain('stroke: currentColor')
    expect(react).toContain('"fill":"none"')
    expect(html).toContain('fill: none')
  })

  it('color 令牌经 span 通道解析（currentColor 驱动描边）；尺寸 default=20px（双通道）', () => {
    const react = designToReactApp(plainTree('icon', { name: 'star', color: 'primary', size: 'default' }), false)
    const html = designToHtml(plainTree('icon', { name: 'star', color: 'primary', size: 'default' }))
    expect(react).toContain(`"color":"${resolveColor('primary')}"`)
    expect(html).toContain(`color: ${resolveColor('primary')}`)
    expect(react).toContain('"width":20')
    expect(html).toContain('width: 20px')
    expect(html).toContain('height: 20px')
  })

  it('未知名兜底：buildIconExport 对未知 name 渲染 help-circle 路径（不抛错不空渲染）', () => {
    const react = designToReactApp(plainTree('icon', { name: '不存在的图标' }), false)
    const html = designToHtml(plainTree('icon', { name: '不存在的图标' }))
    const fallbackPath = (JSON.parse(readFileSync(resolve(process.cwd(), '../shared/icon-library.json'), 'utf-8')) as { icons: Array<{ name: string; path: string }> })
      .icons.find((i) => i.name === 'help-circle')!.path
    expect(react).toContain(`d="${fallbackPath}"`)
    expect(html).toContain(`d="${fallbackPath}"`)
  })
})

describe('T9 switch parity（双形态导出 §5.12：只测一种等于没测另一半）', () => {
  it('checked:true：轨道 primary 底 + 白滑块右移（left 20px）+ 盒模型 40×22/圆角 11（双通道）', () => {
    const props = { label: '接收通知', checked: true }
    const react = designToReactApp(plainTree('switch', props), false)
    const html = designToHtml(plainTree('switch', props))
    expect(react).toContain(`"background":"${resolveColor('primary')}"`)
    expect(html).toContain(`background: ${resolveColor('primary')}`)
    expect(react).toContain('"left":20')
    expect(html).toContain('left: 20px')
    expect(react).toContain('"borderRadius":11')
    expect(html).toContain('border-radius: 11px')
    expect(react).toContain('"width":40')
    expect(html).toContain('width: 40px')
    expect(html).toContain('height: 22px')
  })

  it('checked:false：轨道 border 令牌底 + 滑块左移（left 2px）；反断言：不得混入选中形态的 primary', () => {
    const props = { label: '接收通知', checked: false }
    const react = designToReactApp(plainTree('switch', props), false)
    const html = designToHtml(plainTree('switch', props))
    expect(react).toContain(`"background":"${resolveColor('border')}"`)
    expect(html).toContain(`background: ${resolveColor('border')}`)
    expect(react).toContain('"left":2,')
    expect(html).toContain('left: 2px')
    expect(react, '未选中态不得出现 primary 底').not.toContain(`"background":"${resolveColor('primary')}"`)
    expect(html, '未选中态不得出现 primary 底').not.toContain(`background: ${resolveColor('primary')}`)
  })
})

describe('T9 tabs parity（active 双形态导出 §5.12；复用 items/active 零新增字段）', () => {
  const TABS_PROPS = { items: [{ label: '标签一' }, { label: '标签二' }] }

  it('active:1：第 2 项主色 + 2px 主色下划线，第 1 项 text-light（双通道）', () => {
    const react = designToReactApp(plainTree('tabs', { ...TABS_PROPS, active: 1 }), false)
    const html = designToHtml(plainTree('tabs', { ...TABS_PROPS, active: 1 }))
    const PRIMARY = resolveColor('primary')
    const LIGHT = resolveColor('text-light')
    expect(react).toContain(`"color":"${PRIMARY}"`)
    expect(react).toContain(`"borderBottom":"2px solid ${PRIMARY}"`)
    expect(react).toContain(`"color":"${LIGHT}"`)
    expect(html).toContain(`color: ${PRIMARY}`)
    expect(html).toContain(`border-bottom: 2px solid ${PRIMARY}`)
    expect(html).toContain(`color: ${LIGHT}`)
  })

  it('active:0：第 1 项主色/下划线；反断言：未选中项不得带主色下划线（transparent 占位）', () => {
    const react = designToReactApp(plainTree('tabs', { ...TABS_PROPS, active: 0 }), false)
    const html = designToHtml(plainTree('tabs', { ...TABS_PROPS, active: 0 }))
    const PRIMARY = resolveColor('primary')
    expect(react).toContain(`"borderBottom":"2px solid ${PRIMARY}"`)
    expect(html).toContain(`border-bottom: 2px solid ${PRIMARY}`)
    // 反断言：transparent 下划线恰好 1 处（另一项），且不出现第二个主色下划线
    expect(react.match(new RegExp(`"borderBottom":"2px solid ${PRIMARY}"`, 'g'))).toHaveLength(1)
    expect(html.match(new RegExp(`border-bottom: 2px solid ${PRIMARY}`, 'g'))).toHaveLength(1)
  })
})

describe('T12-A navbar/sidebar 默认观感双通道（口径以画布为准）', () => {
  const NAV = { title: '优选商城', links: [{ label: '首页', href: '#' }, { label: '分类', href: '#' }] }

  it('navbar：高度 56 / 左右内边距 24 / 下边框 border 令牌 / 白底 / 标题 18·600 / 链接 14 与 gap 24（双通道）', () => {
    const react = designToReactApp(plainTree('navbar', NAV), false)
    const html = designToHtml(plainTree('navbar', NAV))
    const BORDER = `1px solid ${resolveColor('border')}`
    // 盒模型（此前导出高度 21px、无内边距/边框/底色）
    expect(react).toContain('"height":56')
    expect(html).toContain('height: 56px')
    expect(react).toContain('"paddingLeft":24')
    expect(html).toContain('padding-left: 24px')
    expect(react).toContain(`"borderBottom":"${BORDER}"`)
    expect(html).toContain(`border-bottom: ${BORDER}`)
    expect(react).toContain('"background":"#FFFFFF"')
    expect(html).toContain('background: #FFFFFF')
    // 标题字号字重（此前 <strong> 默认 16/700）
    expect(react).toContain('"fontSize":18')
    expect(react).toContain('"fontWeight":600')
    expect(html).toContain('font-size: 18px')
    expect(html).toContain('font-weight: 600') // 样式末位属性无尾分号，不断 ';'
    expect(html, 'font-weight 不得被加 px').not.toContain('font-weight: 600px')
    // 链接字号与间距（间距统一到画布 gap-6=24；此前导出 marginLeft 12）
    expect(react).toContain('"fontSize":14')
    expect(html).toContain('font-size: 14px')
    expect(react).toContain('"gap":24')
    expect(html).toContain('gap: 24px')
    expect(react, '旧口径 marginLeft 12 不得回归').not.toContain('"marginLeft":12')
    expect(html, '旧口径 margin-left 12 不得回归').not.toContain('margin-left: 12px')
  })

  it('sidebar：宽度 192 / 外层内边距 16 / 项间距 4 / 纵向排列 + item 圆角 6 与字号 14（此前导出整体丢失）', () => {
    const props = { items: [{ label: '总览' }, { label: '报表' }], active: '总览' }
    const react = designToReactApp(plainTree('sidebar', props), false)
    const html = designToHtml(plainTree('sidebar', props))
    expect(react).toContain('"width":192')
    expect(html).toContain('width: 192px')
    expect(react).toContain('"padding":16')
    expect(html).toContain('padding: 16px')
    expect(react).toContain('"gap":4')
    expect(html).toContain('gap: 4px')
    expect(react).toContain('"flexDirection":"column"')
    expect(html).toContain('flex-direction: column')
    // item 基础观感（此前导出只有 padding，圆角/字号丢失）
    expect(react).toContain('"borderRadius":6')
    expect(html).toContain('border-radius: 6px')
    expect(react).toContain('"padding":"8px 12px"')
    expect(html).toContain('padding: 8px 12px')
    // active/idle 两态仍在（T5-0 基准不回退）
    expect(react).toContain(`"background":"${resolveColor('primary')}"`)
    expect(html).toContain(`background: ${resolveColor('primary')}`)
    expect(react).toContain(`"color":"${resolveColor('text-light')}"`)
  })
})

describe('T12-B hero 默认观感双通道（此前导出≈秃文字）', () => {
  const HERO = { title: '让设计更快一步', subtitle: '自然语言生成高保真界面', cta: { text: '立即开始' } }

  it('容器：内边距 80/48、居中、gap 16、底色 background 令牌（双通道）', () => {
    const react = designToReactApp(plainTree('hero', HERO), false)
    const html = designToHtml(plainTree('hero', HERO))
    expect(react).toContain('"padding":"80px 48px"')
    expect(html).toContain('padding: 80px 48px')
    expect(react).toContain('"flexDirection":"column"')
    expect(html).toContain('flex-direction: column')
    expect(react).toContain('"alignItems":"center"')
    expect(html).toContain('align-items: center')
    expect(react).toContain('"textAlign":"center"')
    expect(html).toContain('text-align: center')
    expect(react).toContain('"gap":16')
    expect(html).toContain('gap: 16px')
    expect(react).toContain(`"background":"${resolveColor('background')}"`)
    expect(html).toContain(`background: ${resolveColor('background')}`)
  })

  it('标题 36/700、副标题 18 + text-light、CTA 复用按钮配方（primary 底/白字/圆角 6/内边距 10·24）', () => {
    const react = designToReactApp(plainTree('hero', HERO), false)
    const html = designToHtml(plainTree('hero', HERO))
    expect(react).toContain('"fontSize":36')
    expect(react).toContain('"fontWeight":700')
    expect(html).toContain('font-size: 36px')
    expect(react).toContain('"fontSize":18')
    expect(react).toContain(`"color":"${resolveColor('text-light')}"`)
    expect(html).toContain('font-size: 18px')
    // CTA 与 button 组件同源：primary 底 + 白字 + 圆角 6 + 内边距 24/10（此前导出是裸 <button>）
    expect(react).toContain(`"background":"${resolveColor('primary')}"`)
    expect(react).toContain('"color":"#FFFFFF"')
    expect(html).toContain(`background: ${resolveColor('primary')}`)
    expect(html).toContain('color: #FFFFFF')
    expect(react).toContain('"borderRadius":6')
    expect(html).toContain('border-radius: 6px')
    expect(react).toContain('"padding":"10px 24px"')
    expect(html).toContain('padding: 10px 24px')
    expect(html, 'CTA 不得回落浏览器默认灰底').not.toContain('rgb(240, 240, 240)')
  })
})

describe('T12-B image 双通道（fit 映射 + 空态口径统一）', () => {
  const BORDER = `1px dashed ${resolveColor('border')}`

  it('有 src：w-full + 圆角 6 + objectFit 映射（cover/contain/fill 逐一断言，双通道）', () => {
    for (const fit of ['cover', 'contain', 'fill'] as const) {
      const props = { src: 'https://cdn.example.com/a.png', alt: '示例图', fit }
      const react = designToReactApp(plainTree('image', props), false)
      const html = designToHtml(plainTree('image', props))
      expect(react, `${fit}: React 缺 objectFit`).toContain(`"objectFit":"${fit}"`)
      expect(html, `${fit}: HTML 缺 object-fit`).toContain(`object-fit: ${fit}`)
      expect(react).toContain('"width":"100%"')
      expect(html).toContain('width: 100%')
      expect(react).toContain('"borderRadius":6')
      expect(html).toContain('border-radius: 6px')
    }
  })

  it('空 src：导出也渲染占位块（虚线 border 令牌 + muted 底 + 高度 160），反断言空 src 不出现', () => {
    const react = designToReactApp(plainTree('image', { alt: '示例图' }), false)
    const html = designToHtml(plainTree('image', { alt: '示例图' }))
    expect(react).toContain(`"border":"${BORDER}"`)
    expect(html).toContain(`border: ${BORDER}`)
    expect(react).toContain('"height":160')
    expect(html).toContain('height: 160px')
    expect(react).toContain('"background":"rgba(245, 245, 245, 0.3)"')
    expect(html).toContain('background: rgba(245, 245, 245, 0.3)')
    expect(react, '空 src 不得再输出 src=""').not.toContain('src=""')
    expect(html, '空 src 不得再输出 src=""').not.toContain('src=""')
  })
})
