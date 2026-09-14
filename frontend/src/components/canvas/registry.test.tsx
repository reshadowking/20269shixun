import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { componentPalette, componentRegistry } from '@/components/canvas/registry'
import { COMPONENT_TYPES } from '@/design/types'
import { resolveColor } from '@/design/styleToCss'
import { VARIANT_CLASS, buttonSchema } from '@/components/canvas/button'
import { CanvasChart } from '@/components/canvas/chart'

/** T5 批A #3：jsdom 渲染不出 ResponsiveContainer 内容（0 SVG，实测），改用
 * mock Recharts 捕获渲染 props——断言的就是画布真实传给 Recharts 的渲染契约。 */
const { captured } = vi.hoisted(() => ({
  captured: {
    XAxis: [] as Array<Record<string, unknown>>,
    YAxis: [] as Array<Record<string, unknown>>,
    CartesianGrid: [] as Array<Record<string, unknown>>,
  },
}))
vi.mock('recharts', async (importOriginal) => {
  const mod = await importOriginal<typeof import('recharts')>()
  const capture = (name: 'XAxis' | 'YAxis' | 'CartesianGrid') => (props: Record<string, unknown>) => {
    captured[name].push(props)
    return null
  }
  // 图表容器透传（真实 BarChart 在无宽高时渲染为空、轴子元素不渲染），声明的轴 props 直达捕获器
  const passthrough = ({ children }: { children: React.ReactNode }) => children as React.ReactElement
  return {
    ...mod,
    ResponsiveContainer: passthrough,
    BarChart: passthrough,
    LineChart: passthrough,
    PieChart: passthrough,
    XAxis: capture('XAxis'),
    YAxis: capture('YAxis'),
    CartesianGrid: capture('CartesianGrid'),
  }
})

/** 令牌 hex → jsdom 内联样式表示（rgb(...)） */
function rgb(hex: string): string {
  const n = parseInt(hex.slice(1), 16)
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`
}

/** B0 契约：前端组件事实源 vs shared/component-library.json（单一来源护栏）。
 * vitest cwd 为 frontend/，shared 在其上一级。 */
const LIB: { components: Array<{ type: string; props: Record<string, { enum?: string[] }> }> } = JSON.parse(
  readFileSync(resolve(process.cwd(), '../shared/component-library.json'), 'utf-8'),
)
const LIB_BUTTON = LIB.components.find((c) => c.type === 'button')!

/** 画布渲染：React 默认转义（渲染通道 XSS 防线，v2.2 §11.2） */
describe('组件画布渲染', () => {
  it('全部组件注册（四件套齐备；数量由 component-library.json 派生，加组件不再手改数字）', () => {
    expect(Object.keys(componentRegistry).sort()).toEqual([...COMPONENT_TYPES].sort())
    expect(componentPalette.length).toBe(LIB.components.length)
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

/** T5 批A：§4.5 残项画布侧内联色（jsdom 读不到 Tailwind 类——这正是这些破洞当年无测试的结构性原因） */
describe('T5 批A 画布内联色收敛', () => {
  it('#6 input label 内联 text-primary（口径：以画布为准）', () => {
    const def = componentRegistry.input
    render(<def.Canvas props={{ label: '邮箱', placeholder: '请输入邮箱' }} />)
    expect(screen.getByText('邮箱').style.color).toBe(rgb(resolveColor('text-primary')!))
  })

  it('#7 stat-block label 内联 text-light（原 text-muted-foreground 类 → 内联令牌）', () => {
    const def = componentRegistry['stat-block']
    render(<def.Canvas props={{ label: '本月营收', value: '¥1.2万' }} />)
    expect(screen.getByText('本月营收').style.color).toBe(rgb(resolveColor('text-light')!))
  })

  it('#8 navbar 链接内联 text-light（hover 仍是交互态，导出不实现）', () => {
    const def = componentRegistry.navbar
    render(<def.Canvas props={{ title: '优选商城', links: [{ label: '首页', href: '#' }] }} />)
    expect(screen.getByText('首页').style.color).toBe(rgb(resolveColor('text-light')!))
  })

  it('#9 table 表头文字内联 text-light、行边框内联 border 令牌（末行保留无线语义）', () => {
    const def = componentRegistry.table
    render(<def.Canvas props={{ columns: [{ key: 'a', title: '列A' }], rows: [{ a: '第一行' }, { a: '单元格值' }] }} />)
    const th = screen.getByText('列A')
    expect(th.style.color).toBe(rgb(resolveColor('text-light')!))
    expect(th.closest('tr')?.style.background).toBe('rgba(245, 245, 245, 0.5)')
    const tr = th.closest('tr')
    // jsdom 读取 borderBottom 时把色值规范化为 rgb(...) 形式
    expect(tr?.style.borderBottom).toBe(`1px solid ${rgb(resolveColor('border')!)}`)
    const firstBodyRow = screen.getByText('第一行').closest('tr')
    expect(firstBodyRow?.style.borderBottom).toBe(`1px solid ${rgb(resolveColor('border')!)}`)
    // 末行无线：与原 last:border-0 语义一致
    const lastRow = screen.getByText('单元格值').closest('tr')
    expect(lastRow?.style.borderBottom).toBe('')
  })

  it('#3 chart tick fill = text-light、grid stroke = border（经渲染 props 捕获）', () => {
    render(
      <CanvasChart
        props={{ chartType: 'bar', title: '月度趋势', data: [{ day: '一月', value: 30 }], xKey: 'day', yKey: 'value' }}
      />,
    )
    const xAxis = captured.XAxis.at(-1) as { tick?: { fill?: string } } | undefined
    const yAxis = captured.YAxis.at(-1) as { tick?: { fill?: string } } | undefined
    const grid = captured.CartesianGrid.at(-1) as { stroke?: string } | undefined
    expect(xAxis?.tick?.fill, 'XAxis tick fill 应为 text-light').toBe(resolveColor('text-light'))
    expect(yAxis?.tick?.fill, 'YAxis tick fill 应为 text-light').toBe(resolveColor('text-light'))
    expect(grid?.stroke, '网格线应为 border 令牌').toBe(resolveColor('border'))
  })
})

/** T5 批B：四件套状态体系（hover/active 走 Tailwind 类、disabled 走内联——jsdom 只能测内联与类名） */
describe('T5 批B 四件套状态', () => {
  it('button disabled：内联 opacity 0.5 + cursor not-allowed（§4.2.5 决策 a：补齐）', () => {
    const def = componentRegistry.button
    const { unmount } = render(<def.Canvas props={{ text: '去支付', disabled: true }} />)
    const el = screen.getByText('去支付')
    expect(el.style.opacity).toBe('0.5')
    expect(el.style.cursor).toBe('not-allowed')
    unmount()
    // 未禁用：不加内联 opacity（保持默认观感）
    render(<def.Canvas props={{ text: '去支付' }} />)
    expect(screen.getByText('去支付').style.opacity).toBe('')
  })

  it('button hover/active：填充变体走 brightness（内联底色上仍生效），ghost 保留 bg-accent', () => {
    expect(VARIANT_CLASS.default).toContain('hover:brightness-90')
    expect(VARIANT_CLASS.default).toContain('active:brightness-80')
    expect(VARIANT_CLASS.default).toContain('cursor-pointer')
    expect(VARIANT_CLASS.ghost).toContain('hover:bg-accent')
  })

  it('input disabled：内联 opacity + cursor（原仅 Tailwind 类，jsdom 不可测）', () => {
    const def = componentRegistry.input
    render(<def.Canvas props={{ placeholder: 'x', disabled: true }} />)
    const input = screen.getByPlaceholderText('x')
    expect(input.style.opacity).toBe('0.5')
    expect(input.style.cursor).toBe('not-allowed')
  })

  it('input focus-visible：ring 用主题 ring 令牌类（非浏览器默认蓝框）', () => {
    expect(componentRegistry.input.schema.length).toBeGreaterThan(0)
    const { container } = render(<componentRegistry.input.Canvas props={{ placeholder: 'x' }} />)
    const input = container.querySelector('input')!
    expect(input.className).toContain('focus-visible:ring-2')
    expect(input.className).toContain('focus-visible:ring-ring')
  })

  it('select：触发器 focus ring 与 input 同口径；label 内联 text-primary；选中态 bg-accent/60 保留', () => {
    const def = componentRegistry.select
    const { container } = render(<def.Canvas props={{ label: '城市', options: ['北京', '上海'] }} />)
    const trigger = container.querySelector('[data-testid="canvas-select-trigger"]')!
    expect(trigger.className).toContain('focus-visible:ring-2')
    expect(trigger.className).toContain('focus-visible:ring-ring')
    expect(screen.getByText('城市').style.color).toBe(rgb(resolveColor('text-primary')!))
    // 选中态（green-lock：既有选中视觉不回退）
    fireEvent.click(trigger)
    // 注：此处用 document 精确查询而非 screen.getByTestId——实测后者对该中文 testid 匹配失败
    const option = document.querySelector('[data-testid="canvas-select-option-北京"]') as HTMLElement
    expect(option, '点击触发器后应出现选项列表').toBeTruthy()
    fireEvent.click(option)
    // 选中态：触发器显示已选值（green-lock：选中交互不回退）
    expect(trigger.textContent).toContain('北京')
    // 重新展开：选中项带 bg-accent/60 + font-medium（既有选中视觉不回退）
    fireEvent.click(trigger)
    const optionAgain = document.querySelector('[data-testid="canvas-select-option-北京"]') as HTMLElement
    expect(optionAgain.className).toContain('bg-accent/60')
    expect(optionAgain.className).toContain('font-medium')
  })

  it('card 默认观感内联：padding/border/圆角/阴影（可测可导出），hover 抬升有意不加', () => {
    const def = componentRegistry.card
    const { container } = render(<def.Canvas props={{ title: '卡片标题', content: '内容' }} />)
    const card = container.firstElementChild as HTMLElement
    expect(card.style.padding).toBe('24px')
    expect(card.style.border).toBe(`1px solid ${rgb(resolveColor('border')!)}`)
    expect(card.style.boxShadow).toBe('0 1px 2px rgba(29,33,41,0.06)') // beautify「极轻」预置
    expect(card.style.borderRadius).toBe('8px')
  })
})

/** T5.5：盒模型/底色内联收敛（#11/#12/#13）——断言的是画布渲染产物（jsdom 可读内联值） */
describe('T5.5 画布盒模型内联', () => {
  it('#13 input 控件本体走 CONTROL_DEFAULT_STYLE：圆角 6px（口径 a 画布现状）、高 40、白底', () => {
    const def = componentRegistry.input
    render(<def.Canvas props={{ placeholder: '请输入邮箱' }} />)
    const input = screen.getByPlaceholderText('请输入邮箱')
    expect(input.style.borderRadius, 'input 圆角应为 6px（rounded-md 现状）').toBe('6px')
    expect(input.style.height, 'input 高度应内联 40px').toBe('40px')
    expect(input.style.background, 'input 底色应内联白').toBe('rgb(255, 255, 255)')
  })

  it('#13 select 触发器同口径：圆角 6px 内联', () => {
    const def = componentRegistry.select
    const { container } = render(<def.Canvas props={{ options: ['北京'] }} />)
    const trigger = container.querySelector('[data-testid="canvas-select-trigger"]') as HTMLElement
    expect(trigger.style.borderRadius, 'select 触发器圆角应为 6px').toBe('6px')
  })

  it('#12 button 静态样式内联：圆角 6/字号 14/字重 500/阴影极轻（交互态类保留）', () => {
    const def = componentRegistry.button
    render(<def.Canvas props={{ text: '去支付' }} />)
    const el = screen.getByText('去支付')
    expect(el.style.borderRadius, 'button 圆角应为 6px').toBe('6px')
    expect(el.style.fontSize, 'button 字号应为 14px（text-sm）').toBe('14px')
    expect(el.style.fontWeight, 'button 字重应为 500（font-medium）').toBe('500')
    expect(el.style.boxShadow, 'button 阴影应为「极轻」预置（shadow-sm 等值）').toBe('0 1px 2px rgba(29,33,41,0.06)')
    // green-lock：交互态类不因内联化丢失
    expect(VARIANT_CLASS.default).toContain('hover:brightness-90')
    expect(VARIANT_CLASS.default).toContain('active:brightness-80')
  })

  it('#11 card 底色/文字色内联（导出不再透明）', () => {
    const def = componentRegistry.card
    const { container } = render(<def.Canvas props={{ title: '卡片标题', content: '内容' }} />)
    const card = container.firstElementChild as HTMLElement
    expect(card.style.background, 'card 底色应为白（bg-card 等值）').toBe('rgb(255, 255, 255)')
    expect(card.style.color, 'card 文字色应为主文本（text-card-foreground 等值）').toBe(rgb(resolveColor('text-primary')!))
  })
})

/** T12-D：tag 彩色标签修复 + 内容/装饰型组件画布内联 */
describe('T12-D 画布内联', () => {
  it('tag 彩色分支：底色为解析后的令牌色（danger → 令牌值）——修复「白字无底色 = 隐形」', () => {
    const def = componentRegistry.tag
    const { container } = render(<def.Canvas props={{ text: '限时 5 折', color: 'danger' }} />)
    const el = container.querySelector('[data-testid="canvas-tag"]') as HTMLElement
    expect(el.style.background).toBe(rgb(resolveColor('danger')!))
    expect(el.style.color).toBe('rgb(255, 255, 255)')
    expect(el.style.borderRadius).toBe('6px')
    expect(el.style.padding).toBe('2px 10px')
    expect(el.style.fontSize).toBe('12px')
    expect(el.style.fontWeight).toBe('600')
  })

  it('tag 默认分支：secondary 底 + 白字（secondary-foreground）内联', () => {
    const def = componentRegistry.tag
    const { container } = render(<def.Canvas props={{ text: '普通标签' }} />)
    const el = container.querySelector('[data-testid="canvas-tag"]') as HTMLElement
    expect(el.style.background).toBe(rgb(resolveColor('secondary')!))
    expect(el.style.color).toBe('rgb(255, 255, 255)')
  })

  it('stat-block 容器内联：圆角 8 / border 令牌 / 白底 / padding 16 / 阴影', () => {
    const def = componentRegistry['stat-block']
    const { container } = render(<def.Canvas props={{ label: 'L', value: 'V' }} />)
    const root = container.firstElementChild as HTMLElement
    expect(root.style.borderRadius).toBe('8px')
    expect(root.style.border).toBe(`1px solid ${rgb(resolveColor('border')!)}`)
    expect(root.style.background).toBe('rgb(255, 255, 255)')
    expect(root.style.padding).toBe('16px')
    expect(root.style.boxShadow).toBe('0 1px 2px rgba(29,33,41,0.06)')
  })

  it('divider 内联：高度 1px / border 令牌色（画布无 margin）', () => {
    const def = componentRegistry.divider
    const { container } = render(<def.Canvas props={{}} />)
    const root = container.firstElementChild as HTMLElement
    expect(root.style.height).toBe('1px')
    expect(root.style.background).toBe(rgb(resolveColor('border')!))
  })

  it('title-text 内联：字重 600 / 行高 1.25 / 字号按等级（此处 level 3 = 20）', () => {
    const def = componentRegistry['title-text']
    render(<def.Canvas props={{ text: '设计师小王', level: 3 }} />)
    const el = screen.getByText('设计师小王')
    expect(el.style.fontWeight).toBe('600')
    expect(el.style.lineHeight).toBe('1.25')
    expect(el.style.fontSize).toBe('20px')
  })

  it('avatar 内联：40×40 / primary 底 / 白字 / 字号 14 / 圆形（圆角与居中沿用既有）', () => {
    const def = componentRegistry.avatar
    const { container } = render(<def.Canvas props={{ name: '设计师' }} />)
    const el = container.firstElementChild as HTMLElement
    expect(el.style.width).toBe('40px')
    expect(el.style.height).toBe('40px')
    expect(el.style.background).toBe(rgb(resolveColor('primary')!))
    expect(el.style.color).toBe('rgb(255, 255, 255)')
    expect(el.style.fontSize).toBe('14px')
    expect(el.style.borderRadius).toBe('50%')
  })
})

/** T12-C：table/chart 默认观感画布侧内联 */
describe('T12-C table/chart 画布内联', () => {
  it('table 画布：容器圆角 8/border 令牌/白底；单元格 padding 16×12；表头左对齐·500；行分隔线内联', () => {
    const def = componentRegistry.table
    const { container } = render(<def.Canvas props={{ columns: [{ key: 'a', title: '列A' }], rows: [{ a: '值1' }] }} />)
    const root = container.firstElementChild as HTMLElement
    expect(root.style.borderRadius).toBe('8px')
    expect(root.style.border).toBe(`1px solid ${rgb(resolveColor('border')!)}`)
    expect(root.style.background).toBe('rgb(255, 255, 255)')
    const th = screen.getByText('列A')
    expect(th.style.padding).toBe('12px 16px')
    expect(th.style.textAlign).toBe('left')
    expect(th.style.fontWeight).toBe('500')
    expect(screen.getByText('值1').style.padding).toBe('12px 16px')
  })

  it('chart 画布：容器圆角 8/border 令牌/白底/padding 16；标题 14·600·mb 16 内联', () => {
    const def = componentRegistry.chart
    const { container } = render(<def.Canvas props={{ chartType: 'bar', title: '月度趋势', data: [{ day: '一月', value: 30 }], xKey: 'day', yKey: 'value' }} />)
    const root = container.querySelector('[data-testid="canvas-chart"]') as HTMLElement
    expect(root.style.borderRadius).toBe('8px')
    expect(root.style.border).toBe(`1px solid ${rgb(resolveColor('border')!)}`)
    expect(root.style.background).toBe('rgb(255, 255, 255)')
    expect(root.style.padding).toBe('16px')
    const title = screen.getByText('月度趋势')
    expect(title.style.fontSize).toBe('14px')
    expect(title.style.fontWeight).toBe('600')
    expect(title.style.marginBottom).toBe('16px')
  })
})

/** T12-B：hero/image 默认观感画布侧内联 */
describe('T12-B hero/image 画布内联', () => {
  it('hero 画布：内边距 80/48、居中、gap 16、底色 background 令牌；标题 36/700；副标题 18 + text-light；CTA primary 底白字', () => {
    const def = componentRegistry.hero
    render(<def.Canvas props={{ title: '让设计更快一步', subtitle: '自然语言生成高保真界面', cta: { text: '立即开始' } }} />)
    const root = screen.getByTestId('canvas-hero')
    expect(root.style.padding).toBe('80px 48px')
    expect(root.style.textAlign).toBe('center')
    expect(root.style.gap).toBe('16px')
    expect(root.style.background).toBe(rgb(resolveColor('background')!))
    const title = screen.getByText('让设计更快一步')
    expect(title.style.fontSize).toBe('36px')
    expect(title.style.fontWeight).toBe('700')
    const sub = screen.getByText('自然语言生成高保真界面')
    expect(sub.style.fontSize).toBe('18px')
    expect(sub.style.color).toBe(rgb(resolveColor('text-light')!))
    const cta = screen.getByText('立即开始')
    expect(cta.style.backgroundColor).toBe(rgb(resolveColor('primary')!))
    expect(cta.style.color).toBe('rgb(255, 255, 255)')
  })

  it('image 空态画布：虚线占位 160 高（border 令牌 + muted 底）内联可测；有图时 objectFit 内联', () => {
    const def = componentRegistry.image
    const { container, unmount } = render(<def.Canvas props={{}} />)
    const placeholder = container.firstElementChild as HTMLElement
    expect(placeholder.style.height).toBe('160px')
    expect(placeholder.style.border).toBe(`1px dashed ${rgb(resolveColor('border')!)}`)
    unmount()
    const { container: c2 } = render(<def.Canvas props={{ src: 'https://x/img.png', fit: 'contain' }} />)
    const img = c2.querySelector('img')!
    expect(img.style.objectFit).toBe('contain')
  })
})

/** T12-A：navbar/sidebar 默认观感画布侧内联（jsdom 读不到 Tailwind 类——T12 把这些观感从类名移入内联） */
describe('T12-A navbar/sidebar 画布内联', () => {
  it('navbar 画布内联：高度 56 / 左右内边距 24 / 下边框 border 令牌 / 白底 / 标题 18·600 / 链接 14 与 gap 24', () => {
    const def = componentRegistry.navbar
    const { container } = render(<def.Canvas props={{ title: '优选商城', links: [{ label: '首页', href: '#' }, { label: '分类', href: '#' }] }} />)
    const root = container.firstElementChild as HTMLElement
    expect(root.style.height).toBe('56px')
    expect(root.style.paddingLeft).toBe('24px')
    expect(root.style.borderBottom).toBe(`1px solid ${rgb(resolveColor('border')!)}`)
    expect(root.style.background).toBe('rgb(255, 255, 255)')
    const title = screen.getByText('优选商城')
    expect(title.style.fontSize).toBe('18px')
    expect(title.style.fontWeight).toBe('600')
    const link = screen.getByText('首页')
    expect(link.style.fontSize).toBe('14px')
    expect((link.parentElement as HTMLElement).style.gap).toBe('24px')
  })

  it('sidebar 画布内联：宽度 192 / 内边距 16 / 项间距 4 / 纵向 + item 圆角 6 与字号 14', () => {
    const def = componentRegistry.sidebar
    const { container } = render(<def.Canvas props={{ items: [{ label: '总览' }, { label: '报表' }], active: '总览' }} />)
    const root = container.firstElementChild as HTMLElement
    expect(root.style.width).toBe('192px')
    expect(root.style.padding).toBe('16px')
    expect(root.style.gap).toBe('4px')
    expect(root.style.flexDirection).toBe('column')
    const item = screen.getByText('报表')
    expect(item.style.padding).toBe('8px 12px')
    expect(item.style.borderRadius).toBe('6px')
    expect(item.style.fontSize).toBe('14px')
    // active 态仍内联（T5-0 基准不回退）
    expect(screen.getByText('总览').style.backgroundColor).toBe(rgb(resolveColor('primary')!))
  })
})

/** T5.6：ghost 变体无阴影（修复前 ghost 被 BUTTON_BASE_STYLE 无条件施加 boxShadow） */
describe('T5.6 ghost 变体阴影', () => {
  it('画布：ghost 无 boxShadow，填充变体仍有「极轻」阴影', () => {
    const def = componentRegistry.button
    const { unmount } = render(<def.Canvas props={{ text: '取消', variant: 'ghost' }} />)
    expect(screen.getByText('取消').style.boxShadow, 'ghost 不应有阴影（修复前无 shadow-sm）').toBe('')
    unmount()
    render(<def.Canvas props={{ text: '去支付', variant: 'primary' }} />)
    expect(screen.getByText('去支付').style.boxShadow).toBe('0 1px 2px rgba(29,33,41,0.06)')
  })
})
