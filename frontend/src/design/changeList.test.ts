/**
 * 变更清单纯函数测试（T49 交付 2）。
 *
 * 重点锁住评审里定下的三条：
 * ① 一条 = 节点 × 变更类型，且**每条只含一个差量分量**（撤回才恰好一个撤销步）；
 * ② `ineffective` 是**字段级**（同一节点"文案生效 + 样式键不支持"不能整条误杀）；
 * ③ `revertBlocked` 用统一判据（撤回引用的 parentId 不在 after 树里）。
 */
import { describe, expect, it } from 'vitest'

import { applyNodePatch } from './applyDiff'
import { buildChangeList, describeDegraded, summarizeChanges, type ChangeItem } from './changeList'
import type { DesignNode } from './types'

function tree(children: DesignNode[], id = 'root', layout: 'free' | 'row' | 'column' | 'grid' = 'column'): DesignNode {
  return { id, type: 'frame', style: { layout }, children }
}

function text(id: string, value: string): DesignNode {
  return { id, type: 'text', props: { text: value } }
}

function card(id: string, shadow?: string): DesignNode {
  return { id, type: 'component', componentType: 'card', style: shadow ? { shadow } : {} }
}

const of = (items: ChangeItem[], kind: string) => items.filter((i) => i.kind === kind)

describe('基本形状', () => {
  it('两棵树相同 → 空清单', () => {
    const a = tree([text('t1', '标题')])
    expect(buildChangeList(a, structuredClone(a))).toEqual([])
  })

  it('改一个可渲染样式键 → 一条 modified，摘要含字段与旧新值', () => {
    const before = tree([card('c1')])
    const after = tree([card('c1', '0 4px 12px rgba(0,0,0,0.1)')])
    const items = buildChangeList(before, after)
    expect(items).toHaveLength(1)
    expect(items[0].kind).toBe('modified')
    expect(items[0].title).toBe('card')
    expect(items[0].summary).toContain('阴影')
    expect(items[0].summary).toContain('0 4px 12px') // 长值会截断，只断言可辨认的前缀
    expect(items[0].summary).toContain('→')
    expect(items[0].hasEffective).toBe(true)
    expect(items[0].allIneffective).toBe(false)
  })

  it('改文案 → 摘要显示 props.text 的旧新值', () => {
    const items = buildChangeList(tree([text('t1', '限时优惠')]), tree([text('t1', '今日限时')]))
    expect(items[0].summary).toBe('文案（text） 限时优惠 → 今日限时')
  })
})

describe('ineffective 是字段级（防误杀）', () => {
  it('不可渲染的样式键 → 标 ineffective，且 allIneffective', () => {
    const before = tree([{ id: 'c1', type: 'component', componentType: 'card', style: {} }])
    const after = tree([{ id: 'c1', type: 'component', componentType: 'card', style: { boxSizing: 'border-box' } }])
    const items = buildChangeList(before, after)
    expect(items[0].allIneffective).toBe(true)
    expect(items[0].hasEffective).toBe(false)
    // 摘要标"未生效"，具体原因在结构化字段里（卡片另行展示）
    expect(items[0].summary).toContain('（未生效）')
    expect(items[0].fields[0].ineffective).toBe('渲染层不支持这个样式键')
  })

  it('**同一节点**「文案生效 + 样式键不支持」→ 仍是一条且 hasEffective（不整条误杀）', () => {
    const before = tree([{ id: 'c1', type: 'component', componentType: 'card', props: { text: 'A' }, style: {} }])
    const after = tree([
      { id: 'c1', type: 'component', componentType: 'card', props: { text: 'B' }, style: { boxSizing: 'border-box' } },
    ])
    const items = buildChangeList(before, after)
    expect(items).toHaveLength(1)
    expect(items[0].hasEffective).toBe(true)
    expect(items[0].allIneffective).toBe(false)
    const summary = summarizeChanges(items)
    expect(summary.effective).toBe(1)
    expect(summary.ineffectiveFields).toBe(1) // 有一个字段不生效，但条目仍算生效
  })

  it('流式布局下的 x/y 调整标 ineffective；free 布局下不标', () => {
    const before = tree([{ id: 'c1', type: 'component', componentType: 'card', style: {} }])
    const after = tree([{ id: 'c1', type: 'component', componentType: 'card', style: {}, x: 20 }])
    expect(buildChangeList(before, after)[0].fields[0].ineffective).toContain('流式布局')

    const freeBefore: DesignNode = {
      id: 'root', type: 'frame', style: { layout: 'free' },
      children: [{ id: 'c1', type: 'component', componentType: 'card', style: {}, x: 0 }],
    }
    const freeAfter: DesignNode = structuredClone(freeBefore)
    freeAfter.children![0].x = 20
    expect(buildChangeList(freeBefore, freeAfter)[0].fields[0].ineffective).toBeUndefined()
  })
})

describe('一条 = 节点 × 变更类型（单条撤回 ⇒ 一个差量分量）', () => {
  it('同一节点既移动又改样式 → 拆成两条，各自只含一个分量', () => {
    const before = tree([card('c1'), { id: 'box', type: 'frame', style: { layout: 'column' }, children: [] }])
    const after: DesignNode = {
      id: 'root', type: 'frame', style: { layout: 'column' },
      children: [{ id: 'box', type: 'frame', style: { layout: 'column' }, children: [card('c1', '0 4px 12px rgba(0,0,0,.1)')] }],
    }
    const items = buildChangeList(before, after)
    const moved = of(items, 'moved')
    const modified = of(items, 'modified')
    expect(moved).toHaveLength(1)
    expect(modified).toHaveLength(1)

    const componentsOf = (item: ChangeItem) =>
      [item.revert.removed, item.revert.moved, item.revert.updated, item.revert.added, item.revert.orders].filter(
        (list) => list.length > 0,
      ).length
    expect(componentsOf(moved[0])).toBe(1)
    expect(componentsOf(modified[0])).toBe(1)
  })

  it('modified 的多个字段仍是一条（同一个 NodePatch）', () => {
    const before = tree([card('c1')])
    const after = tree([{ id: 'c1', type: 'component', componentType: 'card', style: { shadow: 'x', radius: 12, opacity: 0.7 } }])
    const items = buildChangeList(before, after)
    expect(items).toHaveLength(1)
    expect(items[0].fields).toHaveLength(3)
    expect(items[0].revert.updated).toHaveLength(1)
  })
})

describe('revert 差量正确性', () => {
  it('modified 的反向补丁把值改回旧值（可直接喂 applyAiDiff）', () => {
    const before = tree([card('c1', '旧阴影')])
    const after = tree([card('c1', '新阴影')])
    const patch = buildChangeList(before, after)[0].revert.updated[0].patch
    const reverted = applyNodePatch(after.children![0], patch)
    expect(reverted.style?.shadow).toBe('旧阴影')
  })

  it('added 的撤回是整体移除该节点', () => {
    const before = tree([])
    const after = tree([card('c1')])
    const items = buildChangeList(before, after)
    expect(items).toHaveLength(1)
    expect(items[0].revert.removed).toEqual(['c1'])
  })

  it('removed 的撤回把旧子树插回原父级的原索引', () => {
    const before = tree([text('t1', 'A'), card('c1'), text('t2', 'B')])
    const after = tree([text('t1', 'A'), text('t2', 'B')])
    const items = buildChangeList(before, after)
    expect(items).toHaveLength(1)
    expect(items[0].revert.added).toEqual([{ parentId: 'root', index: 1, node: before.children![1] }])
  })

  it('reordered 的撤回回到旧顺序', () => {
    const before = tree([text('a', 'A'), text('b', 'B')])
    const after = tree([text('b', 'B'), text('a', 'A')])
    const items = of(buildChangeList(before, after), 'reordered')
    expect(items).toHaveLength(1)
    expect(items[0].revert.orders).toEqual([{ parentId: 'root', ids: ['a', 'b'] }])
  })
})

describe('revertBlocked（统一判据：引用的 parentId 必须在 after 树里）', () => {
  it('移到别处、而原父级被同时删除 → 不给单条撤回', () => {
    const before: DesignNode = {
      id: 'root', type: 'frame', style: { layout: 'column' },
      children: [
        { id: 'gone', type: 'frame', style: { layout: 'column' }, children: [card('c1')] },
        { id: 'stay', type: 'frame', style: { layout: 'column' }, children: [] },
      ],
    }
    const after: DesignNode = {
      id: 'root', type: 'frame', style: { layout: 'column' },
      children: [{ id: 'stay', type: 'frame', style: { layout: 'column' }, children: [card('c1')] }],
    }
    const moved = of(buildChangeList(before, after), 'moved')
    expect(moved).toHaveLength(1)
    expect(moved[0].revertBlocked).toContain('Ctrl+Z')
  })

  it('普通改动不受影响（可单条撤回）', () => {
    const items = buildChangeList(tree([card('c1')]), tree([card('c1', '新阴影')]))
    expect(items[0].revertBlocked).toBeUndefined()
  })

  it('父级被删时，其子孙不再单独成条（由父级那条带走，避免一堆不可撤回的孤儿）', () => {
    const before: DesignNode = {
      id: 'root', type: 'frame', style: { layout: 'column' },
      children: [{ id: 'gone', type: 'frame', style: { layout: 'column' }, children: [text('t1', 'A')] }],
    }
    const after = tree([])
    const items = buildChangeList(before, after)
    expect(items).toHaveLength(1)
    expect(items[0].id).toBe('gone')
    expect(items.filter((i) => i.id === 't1')).toHaveLength(0)
  })
})

describe('summarizeChanges', () => {
  it('分别统计总条数、生效条数、全无效条数与无效字段数', () => {
    const before = tree([card('c1'), card('c2')])
    const after = tree([
      { id: 'c1', type: 'component', componentType: 'card', style: { shadow: '新' } }, // 生效
      { id: 'c2', type: 'component', componentType: 'card', style: { boxSizing: 'border-box' } }, // 全无效
    ])
    const summary = summarizeChanges(buildChangeList(before, after))
    expect(summary).toEqual({ total: 2, effective: 1, allIneffective: 1, ineffectiveFields: 1 })
  })
})

describe('describeDegraded（降级明细转人话）', () => {
  it('"能力@节点id" → 「能力」（节点 id）', () => {
    expect(describeDegraded(['text@lm-sub', 'pagination@x'])).toEqual([
      '「text」（节点 lm-sub）',
      '「pagination」（节点 x）',
    ])
  })

  it('无 @ 的条目原样返回（容错）', () => {
    expect(describeDegraded(['未知能力'])).toEqual(['未知能力'])
    expect(describeDegraded(['@orphan'])).toEqual(['@orphan'])
  })

  it('空数组 → 空列表', () => {
    expect(describeDegraded([])).toEqual([])
  })
})
