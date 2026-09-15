/**
 * T9 tabs 组件测试：
 * - 状态进树（方案②）：props.active 是唯一真相（number index 为唯一写入口径，string 标签
 *   文本为容错读取形态——口径写进实现注释）；组件不持有内部语义 state（hover 是瞬时视觉态，
 *   不属于语义状态，不入树不导出）。
 * - 复用既有 items/active 字段（零新增 props 字段）。
 * - §5.10 三件套（点击写树/一步可撤销/面板共用同一真相）+ §5.11 锁定被拦 + 双形态导出。
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { fireEvent, render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { DesignNode } from '@/design/types'
import { resolveColor } from '@/design/styleToCss'
import { DesignStore } from '@/yjs/designStore'
import { CanvasTabs, buildTabsExport, parseTabsItems, tabsSchema } from './index'

function tabsTree(active?: string | number): DesignNode {
  return {
    id: 'root', type: 'frame', style: { layout: 'column' },
    children: [{
      id: 'tb', type: 'component', componentType: 'tabs',
      props: { items: [{ label: '标签一' }, { label: '标签二' }], ...(active !== undefined ? { active } : {}) },
    }],
  }
}

function hexToRgb(hex: string): string {
  const n = parseInt(hex.slice(1), 16)
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`
}

const PRIMARY = `rgb(${hexToRgb(resolveColor('primary')!)})`
const LIGHT = `rgb(${hexToRgb(resolveColor('text-light')!)})`

describe('tabs 画布渲染（状态进树方案②）', () => {
  it('active:1（number index）→ 第 2 项主色 + 2px 主色下划线；第 1 项 text-light', () => {
    const { getByText } = render(<CanvasTabs props={{ items: [{ label: '标签一' }, { label: '标签二' }], active: 1 }} />)
    const first = getByText('标签一')
    const second = getByText('标签二')
    expect(second.style.color).toBe(PRIMARY)
    expect(second.style.borderBottomColor).toBe(`rgb(${hexToRgb(resolveColor('primary')!)})`)
    expect(second.style.borderBottomWidth).toBe('2px')
    expect(first.style.color).toBe(LIGHT)
  })

  it('点击标签 → onPropsChange("active", index)——number index 为唯一写入口径（实现注释声明）', () => {
    const onPropsChange = vi.fn()
    const { getByText } = render(
      <CanvasTabs props={{ items: [{ label: '标签一' }, { label: '标签二' }], active: 1 }} onPropsChange={onPropsChange} />,
    )
    fireEvent.click(getByText('标签一'))
    expect(onPropsChange).toHaveBeenCalledWith('active', 0)
  })

  it('受控：props 反转后点击另一项写对应 index（单一真相，无内部语义 state）', () => {
    const onPropsChange = vi.fn()
    const { getByText, rerender } = render(
      <CanvasTabs props={{ items: [{ label: '标签一' }, { label: '标签二' }] }} onPropsChange={onPropsChange} />,
    )
    fireEvent.click(getByText('标签二'))
    expect(onPropsChange).toHaveBeenLastCalledWith('active', 1)
    rerender(<CanvasTabs props={{ items: [{ label: '标签一' }, { label: '标签二' }], active: 1 }} onPropsChange={onPropsChange} />)
    fireEvent.click(getByText('标签一'))
    expect(onPropsChange).toHaveBeenLastCalledWith('active', 0)
  })

  it('active 容错：string 标签文本命中也高亮（容错读取形态，与 sidebar 的 string 口径兼容）', () => {
    const { getByText } = render(<CanvasTabs props={{ items: [{ label: '标签一' }, { label: '标签二' }], active: '标签二' }} />)
    expect(getByText('标签二').style.color).toBe(PRIMARY)
    expect(getByText('标签一').style.color).toBe(LIGHT)
  })

  it('items 元素缺 label / 字符串元素容错；整体字符串按 JSON 尝试解析（面板 textarea 手输场景）', () => {
    expect(parseTabsItems([{ label: 'A' }, { other: 1 }, 'C'])).toEqual(['A', 'C'])  // 缺 label 的对象丢弃
    expect(parseTabsItems('[{"label":"甲"},{"label":"乙"}]')).toEqual(['甲', '乙'])
    expect(parseTabsItems('不是 JSON')).toEqual([])
    expect(parseTabsItems(undefined)).toEqual([])
  })

  it('空 items：渲染占位文本（导出同源渲染占位）', () => {
    const { getByText } = render(<CanvasTabs props={{}} />)
    expect(getByText('标签页')).toBeTruthy()
  })
})

describe('tabs 状态进树 + 可撤销 + 锁定被拦（§5.10/§5.11）', () => {
  it('① 点击写回链路 → props.active 被更新（断言节点数据）；② 一步可撤销', () => {
    const store = new DesignStore(undefined, tabsTree())
    // 与 DesignCanvas 的 onComponentPropsChange 完全相同的写回
    store.updateNode('tb', (n) => ({ ...n, props: { ...(n.props ?? {}), active: 1 } }))
    expect((store.getDesign().children![0].props as { active?: unknown }).active).toBe(1)
    expect(store.undo()).toBe(true)
    expect((store.getDesign().children![0].props as { active?: unknown }).active).toBeFalsy()
    store.destroy()
  })

  it('③ 只有一个真相：面板写回（PropertyPanel.setProp 同款 update）与画布写回落到同一 props.active', () => {
    const store = new DesignStore(undefined, tabsTree())
    store.updateNode('tb', (n) => ({ ...n, props: { ...(n.props ?? {}), active: 1 } })) // 画布点击
    store.updateNode('tb', (n) => ({ ...n, props: { ...(n.props ?? {}), active: 0 } })) // 面板 number
    expect((store.getDesign().children![0].props as { active?: unknown }).active).toBe(0)
    expect(tabsSchema.find((f) => f.key === 'active')).toMatchObject({ control: 'number' })
    store.destroy()
  })

  it('§5.11 版面锁定：点击被写入层拒绝——active 不变且触发 subscribeBlocked 可见提示', () => {
    const store = new DesignStore(undefined, tabsTree())
    store.setBeautifyLock(true)
    const blocked: string[] = []
    const unsub = store.subscribeBlocked((reason) => blocked.push(reason))
    store.updateNode('tb', (n) => ({ ...n, props: { ...(n.props ?? {}), active: 1 } }))
    expect((store.getDesign().children![0].props as { active?: unknown }).active).toBeFalsy()
    expect(blocked).toHaveLength(1)
    expect(blocked[0]).toContain('锁定')
    unsub()
    store.destroy()
  })
})

describe('tabs 导出语义与属性面板', () => {
  it('buildTabsExport：active:1 → 第 2 项主色/下划线、第 1 项 text-light；active:0 反转（双形态）', () => {
    const PRIMARY_HEX = resolveColor('primary')!
    const LIGHT_HEX = resolveColor('text-light')!
    const nodeOf = (active: number): DesignNode => ({
      id: 't', type: 'component', componentType: 'tabs',
      props: { items: [{ label: '标签一' }, { label: '标签二' }], active },
    })
    const el1 = buildTabsExport(nodeOf(1))
    expect(el1.tag).toBe('div')
    expect(el1.attrs).toEqual({ role: 'tablist' })
    const [first, second] = el1.children!
    expect(first.style.color).toBe(LIGHT_HEX)
    expect(first.style.borderBottom).toBe('2px solid transparent')
    expect(second.style.color).toBe(PRIMARY_HEX)
    expect(second.style.borderBottom).toBe(`2px solid ${PRIMARY_HEX}`)
    expect(second.text).toBe('标签二')
    const el0 = buildTabsExport(nodeOf(0))
    const [first0, second0] = el0.children!
    expect(first0.style.color).toBe(PRIMARY_HEX)
    expect(second0.style.color).toBe(LIGHT_HEX)
  })

  it('「点击切换」交互不导出：产物无事件属性（与 button hover 同口径，注释声明）', () => {
    const el = buildTabsExport(tabsTree(1).children![0])
    const serialized = JSON.stringify(el)
    expect(serialized).not.toContain('onClick')
    expect(serialized).not.toContain('onchange')
  })

  it('属性面板字段数与组件库声明一致（§7 字段数量不膨胀：items/active）', () => {
    const LIB = JSON.parse(
      readFileSync(resolve(process.cwd(), '../shared/component-library.json'), 'utf-8'),
    ) as { components: Array<{ type: string; props: Record<string, unknown> }> }
    const libProps = LIB.components.find((c) => c.type === 'tabs')!.props
    expect(tabsSchema.map((f) => f.key).sort()).toEqual(Object.keys(libProps).sort())
    expect(tabsSchema).toHaveLength(2)
  })
})
