/**
 * T9 switch 组件测试：
 * - 状态进树（方案②）：props.checked 是唯一真相——组件不持有内部 useState（CanvasSelect 的
 *   既有缺陷正是内部 state：选中值不进树、撤销/协作/导出全丢，本轮明确避开该模式）；
 * - 点击链路（onPropsChange → DesignCanvas 的 store.updateNode）写树、一步可撤销；
 * - §4.4/§5.11 版面锁定：点击被写入层拒绝且触发 subscribeBlocked 可见提示（状态写 props 后
 *   与版面锁定的数据层守卫相撞——锁定 = 冻结文案与布局，属预期语义，但不能静默）；
 * - 双形态导出（checked true/false）与属性面板字段数不膨胀。
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { fireEvent, render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { DesignNode } from '@/design/types'
import { resolveColor } from '@/design/styleToCss'
import { DesignStore } from '@/yjs/designStore'
import { CanvasSwitch, buildSwitchExport, switchSchema } from './index'

const LIB = JSON.parse(
  readFileSync(resolve(process.cwd(), '../shared/component-library.json'), 'utf-8'),
) as { components: Array<{ type: string; props: Record<string, unknown> }> }

function switchTree(): DesignNode {
  return {
    id: 'root', type: 'frame', style: { layout: 'column' },
    children: [{ id: 'sw', type: 'component', componentType: 'switch', props: { label: '接收通知' } }],
  }
}

function hexToRgb(hex: string): string {
  const n = parseInt(hex.slice(1), 16)
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`
}

function trackOf(container: HTMLElement): HTMLElement {
  return container.querySelector('[data-testid="canvas-switch-track"]') as HTMLElement
}

describe('switch 画布渲染（状态进树方案②）', () => {
  it('点击轨道 → onPropsChange("checked", true)；props 反转后再点 → false（受控，无内部 state）', () => {
    const onPropsChange = vi.fn()
    const { container, rerender } = render(<CanvasSwitch props={{ label: '接收通知' }} onPropsChange={onPropsChange} />)
    fireEvent.click(trackOf(container))
    expect(onPropsChange).toHaveBeenCalledWith('checked', true)
    // 形态完全由 props 决定（父级写回 props 后重渲染即反相）——单一真相的结构性证据
    rerender(<CanvasSwitch props={{ label: '接收通知', checked: true }} onPropsChange={onPropsChange} />)
    fireEvent.click(trackOf(container))
    expect(onPropsChange).toHaveBeenLastCalledWith('checked', false)
  })

  it('checked=true：主色底 + 白滑块右移（left 20px）；checked=false：border 令牌底 + 左移（left 2px）', () => {
    const { container, unmount } = render(<CanvasSwitch props={{ checked: true }} />)
    const track = trackOf(container)
    expect(track.style.background).toBe(`rgb(${hexToRgb(resolveColor('primary')!)})`)
    expect((track.firstElementChild as HTMLElement).style.left).toBe('20px')
    expect((track.firstElementChild as HTMLElement).style.background).toBe('rgb(255, 255, 255)')
    unmount()
    const { container: c2 } = render(<CanvasSwitch props={{ checked: false }} />)
    const track2 = trackOf(c2)
    expect(track2.style.background).toBe(`rgb(${hexToRgb(resolveColor('border')!)})`)
    expect((track2.firstElementChild as HTMLElement).style.left).toBe('2px')
  })

  it('盒模型内联：轨道 40×22、全圆角 11（画布/导出同源常量）', () => {
    const { container } = render(<CanvasSwitch props={{}} />)
    const track = trackOf(container)
    expect(track.style.width).toBe('40px')
    expect(track.style.height).toBe('22px')
    expect(track.style.borderRadius).toBe('11px')
  })

  it('disabled：复用 DISABLED_STYLE（opacity 0.5 + cursor not-allowed），点击不切换', () => {
    const onPropsChange = vi.fn()
    const { container } = render(<CanvasSwitch props={{ disabled: true }} onPropsChange={onPropsChange} />)
    const track = trackOf(container)
    expect(track.style.opacity).toBe('0.5')
    expect(track.style.cursor).toBe('not-allowed')
    fireEvent.click(track)
    expect(onPropsChange).not.toHaveBeenCalled()
  })

  it('label 渲染且色为 text-primary；点击 label 区域不切换（只有轨道是热区）', () => {
    const onPropsChange = vi.fn()
    const { container, getByText } = render(<CanvasSwitch props={{ label: '接收通知' }} onPropsChange={onPropsChange} />)
    expect(getByText('接收通知').style.color).toBe(`rgb(${hexToRgb(resolveColor('text-primary')!)})`)
    fireEvent.click(getByText('接收通知'))
    expect(onPropsChange).not.toHaveBeenCalled()
    expect(container).toBeTruthy()
  })
})

describe('switch 状态进树 + 可撤销 + 锁定被拦（§5.10/§5.11）', () => {
  it('① 画布点击写回链路（onPropsChange → store.updateNode）→ props 被更新（断言节点数据）；② 一步可撤销', () => {
    const store = new DesignStore(undefined, switchTree())
    // 与 DesignCanvas 的 onComponentPropsChange 完全相同的写回（画布点击走的就是它）
    store.updateNode('sw', (n) => ({ ...n, props: { ...(n.props ?? {}), checked: true } }))
    const node = store.getDesign().children![0]
    expect(node.props).toMatchObject({ label: '接收通知', checked: true })
    expect(store.undo()).toBe(true)
    expect((store.getDesign().children![0].props as { checked?: boolean }).checked).toBeFalsy()
    store.destroy()
  })

  it('③ 只有一个真相：面板写回（PropertyPanel.setProp 同款 update）与画布写回落到同一 props.checked，无第二份存储', () => {
    const store = new DesignStore(undefined, switchTree())
    store.updateNode('sw', (n) => ({ ...n, props: { ...(n.props ?? {}), checked: true } })) // 画布点击
    store.updateNode('sw', (n) => ({ ...n, props: { ...(n.props ?? {}), checked: false } })) // 面板开关
    const node = store.getDesign().children![0]
    expect((node.props as { checked?: boolean }).checked).toBe(false)
    // 面板由 schema 驱动声明 checked 字段；组件无内部 state（上方受控渲染测试已证）
    expect(switchSchema.find((f) => f.key === 'checked')).toMatchObject({ control: 'switch' })
    store.destroy()
  })

  it('§5.11 版面锁定：点击被写入层拒绝——状态不变且触发 subscribeBlocked 可见提示（WorkspacePage lockHint 消费）', () => {
    const store = new DesignStore(undefined, switchTree())
    store.setBeautifyLock(true)
    const blocked: string[] = []
    const unsub = store.subscribeBlocked((reason) => blocked.push(reason))
    store.updateNode('sw', (n) => ({ ...n, props: { ...(n.props ?? {}), checked: true } }))
    expect((store.getDesign().children![0].props as { checked?: boolean }).checked).toBeFalsy()
    expect(blocked).toHaveLength(1)
    expect(blocked[0]).toContain('锁定')
    unsub()
    store.destroy()
  })
})

describe('switch 导出语义与属性面板', () => {
  it('buildSwitchExport：checked=true 轨道 primary/滑块 left 20；false 轨道 border/滑块 left 2（两种形态都可导出）', () => {
    const nodeOf = (checked: boolean): DesignNode => ({ id: 's', type: 'component', componentType: 'switch', props: { label: '接收通知', checked } })
    const on = buildSwitchExport(nodeOf(true))
    const track = on.children![0]
    expect(on.tag).toBe('div')
    expect(track.style.background).toBe(resolveColor('primary'))
    expect(track.children![0].style.left).toBe(20)
    const off = buildSwitchExport(nodeOf(false))
    expect(off.children![0].style.background).toBe(resolveColor('border'))
    expect(off.children![0].children![0].style.left).toBe(2)
  })

  it('「点击切换」交互不导出：产物无事件属性（与 button 的 hover 同口径，组件注释声明）', () => {
    const el = buildSwitchExport({ id: 's', type: 'component', componentType: 'switch', props: { checked: true } })
    const serialized = JSON.stringify(el)
    expect(serialized).not.toContain('onClick')
    expect(serialized).not.toContain('onchange')
  })

  it('属性面板字段数与组件库声明一致（§7 字段数量不膨胀：label/checked/disabled）', () => {
    const libProps = LIB.components.find((c) => c.type === 'switch')!.props
    expect(switchSchema.map((f) => f.key).sort()).toEqual(Object.keys(libProps).sort())
    expect(switchSchema).toHaveLength(3)
  })
})
