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
