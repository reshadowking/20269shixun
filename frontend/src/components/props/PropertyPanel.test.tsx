/**
 * T9.1 #21：属性面板 JSON 控件测试。
 * 背景（缺口清单 §4.8 #21）：items/links/columns/rows/data 等数组字段此前用 textarea +
 * `String(value)` → 显示 `[object Object]`、手改后把字符串写回 props（字符串进树后
 * 在增量生成路径会被后端 repair 删除）。本控件：显示 JSON.stringify、编辑经 JSON.parse
 * 校验后才写回、非法输入不落树并给出可见提示。
 */
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { chartSchema } from '@/components/canvas/chart'
import { navbarSchema } from '@/components/canvas/navbar'
import { sidebarSchema } from '@/components/canvas/sidebar'
import { tableSchema } from '@/components/canvas/table'
import { tabsSchema } from '@/components/canvas/tabs'
import type { DesignNode } from '@/design/types'
import PropertyPanel from './PropertyPanel'

function sidebarNode(): DesignNode {
  return {
    id: 'sb', type: 'component', componentType: 'sidebar',
    props: { items: [{ label: '总览' }, { label: '设置' }] },
  }
}

/** 渲染面板并捕获 onUpdate 的 updater 实际写出的新节点 */
function renderPanel(node: DesignNode) {
  let written: DesignNode | null = null
  const onUpdate = vi.fn((fn: (n: DesignNode) => DesignNode) => {
    written = fn(node)
  })
  render(<PropertyPanel node={node} onUpdate={onUpdate} onDelete={vi.fn()} onMoveLayer={vi.fn()} />)
  return {
    onUpdate,
    getWritten: () => written,
    itemsBox: () => screen.getByTestId('prop-items') as HTMLTextAreaElement,
  }
}

describe('属性面板 JSON 控件（#21）', () => {
  it('数组字段显示为 JSON 文本，不再是 [object Object]', () => {
    const { itemsBox } = renderPanel(sidebarNode())
    expect(itemsBox().value).toContain('"label"')
    expect(itemsBox().value).toContain('总览')
    expect(itemsBox().value).not.toContain('[object Object]')
  })

  it('编辑为合法 JSON → 写回解析后的数组（不再把字符串写进 props）', () => {
    const { itemsBox, getWritten } = renderPanel(sidebarNode())
    fireEvent.change(itemsBox(), { target: { value: '[{"label":"首页"},{"label":"报表"}]' } })
    expect(getWritten()?.props?.items).toEqual([{ label: '首页' }, { label: '报表' }])
  })

  it('非法 JSON → 不写树 + 显示错误提示（坏输入不落树）', () => {
    const { itemsBox, onUpdate } = renderPanel(sidebarNode())
    fireEvent.change(itemsBox(), { target: { value: '[{"label":' } })
    expect(onUpdate).not.toHaveBeenCalled()
    expect(screen.getByTestId('json-error-items').textContent).toContain('JSON 无效')
  })

  it('非法输入后继续编辑为合法 → 错误提示消失且写回恢复', () => {
    const { itemsBox, getWritten, onUpdate } = renderPanel(sidebarNode())
    fireEvent.change(itemsBox(), { target: { value: '[oops' } })
    expect(onUpdate).not.toHaveBeenCalled()
    fireEvent.change(itemsBox(), { target: { value: '[{"label":"甲"}]' } })
    expect(screen.queryByTestId('json-error-items')).toBeNull()
    expect(getWritten()?.props?.items).toEqual([{ label: '甲' }])
  })

  it('清空输入 → 写回空数组（当前全部 json 字段消费方均为数组）', () => {
    const { itemsBox, getWritten } = renderPanel(sidebarNode())
    fireEvent.change(itemsBox(), { target: { value: '   ' } })
    expect(getWritten()?.props?.items).toEqual([])
  })

  it('T13 #25：对象/标量 JSON 被拒——必须是 JSON 数组（不落树 + 可见提示）', () => {
    const { itemsBox, onUpdate } = renderPanel(sidebarNode())
    fireEvent.change(itemsBox(), { target: { value: '{"label":"A"}' } })
    expect(onUpdate).not.toHaveBeenCalled()
    expect(screen.getByTestId('json-error-items').textContent).toContain('数组')
    fireEvent.change(itemsBox(), { target: { value: '123' } })
    expect(onUpdate).not.toHaveBeenCalled()
    fireEvent.change(itemsBox(), { target: { value: '[{"label":"A"}]' } })
    expect(screen.queryByTestId('json-error-items')).toBeNull()
  })

  it('六个数组字段统一使用 json 控件（sidebar/tabs 同类问题一并处理）', () => {
    // 每个字段一次断言：control 必须是 json（而非 textarea——旧控件会 String 化显示与写回）
    const cases: Array<[string, Array<{ key: string; control: string }>]> = [
      ['sidebar.items', [sidebarSchema.find((f) => f.key === 'items')!]],
      ['tabs.items', [tabsSchema.find((f) => f.key === 'items')!]],
      ['chart.data', [chartSchema.find((f) => f.key === 'data')!]],
      ['navbar.links', [navbarSchema.find((f) => f.key === 'links')!]],
      ['table.columns', [tableSchema.find((f) => f.key === 'columns')!]],
      ['table.rows', [tableSchema.find((f) => f.key === 'rows')!]],
    ]
    for (const [name, fields] of cases) {
      expect(fields[0].control, `${name} 应使用 json 控件`).toBe('json')
    }
  })
})
