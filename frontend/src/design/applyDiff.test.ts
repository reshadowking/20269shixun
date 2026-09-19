/**
 * AI 差量落地（2026-09-17）。最重要的一条是**并发保命**：
 * 请求发出到落地之间，队友改过的"未被 AI 碰过的节点"必须存活——
 * 原来的整树替换会把它们一起吞掉。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { DesignNode } from '@/design/types'
import { DesignStore } from '@/yjs/designStore'

import { applyDesignDiff, diffDesign, planAiLanding } from './applyDiff'

vi.mock('y-websocket', async () => ({
  WebsocketProvider: (await import('../test/fakeYWebSocket')).FakeWebsocketProvider,
}))

function base(): DesignNode {
  return {
    id: 'root',
    type: 'frame',
    style: { layout: 'column' },
    children: [
      { id: 'a', type: 'text', props: { text: '标题' }, style: {} },
      { id: 'b', type: 'text', props: { text: '副标题' }, style: {} },
    ],
  }
}

function store(): DesignStore {
  const s = new DesignStore('ws://fake:1234', base(), 'room-diff')
  s.connectProvider()
  return s
}

describe('diffDesign / applyDesignDiff', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('只把改过的节点写进去（其余节点不动）', () => {
    const s = store()
    const before = s.getDesign()
    const after: DesignNode = { ...before, children: [before.children![0], { ...before.children![1], props: { text: 'AI 改的' } }] }

    const diff = diffDesign(before, after)
    expect(diff.updated.map((u) => u.id)).toEqual(['b'])
    expect(diff.removed).toEqual([])
    expect(diff.added).toEqual([])

    applyDesignDiff(s, diff)
    expect(s.getDesign().children?.map((c) => c.id)).toEqual(['a', 'b'])
    expect(s.getDesign().children?.[1].props?.text).toBe('AI 改的')
    s.destroy()
  })

  it('并发保命：请求期间队友改了**别的**节点 → 落地后队友的改动仍在', () => {
    const s = store()
    const before = s.getDesign() // 这就是发给后端的树
    const after: DesignNode = {
      ...before,
      children: [before.children![0], { ...before.children![1], props: { text: 'AI 改的' } }],
    }
    // 队友在我等待期间改了节点 a（AI 没有碰它）
    s.__applyRemoteForTests('a', (n) => ({ ...n, props: { ...n.props, text: '队友改的' } }))

    applyDesignDiff(s, diffDesign(before, after))
    const kids = s.getDesign().children ?? []
    expect(kids.find((c) => c.id === 'a')?.props?.text, '队友的改动必须存活').toBe('队友改的')
    expect(kids.find((c) => c.id === 'b')?.props?.text).toBe('AI 改的')
    s.destroy()
  })

  it('新增 / 删除 / 换父级都按差量落地', () => {
    const s = store()
    const before = s.getDesign()
    const after: DesignNode = {
      id: 'root',
      type: 'frame',
      style: { layout: 'column' },
      children: [
        { id: 'a', type: 'text', props: { text: '标题' }, style: {} },
        {
          id: 'box',
          type: 'frame',
          style: { layout: 'row' },
          children: [{ id: 'b', type: 'text', props: { text: '副标题' }, style: {} }],
        },
        { id: 'new-1', type: 'component', componentType: 'button', props: { text: '新增' }, style: {} },
      ],
    }

    const diff = diffDesign(before, after)
    expect(diff.added.map((x) => x.node.id).sort()).toEqual(['box', 'new-1'])
    expect(diff.removed).toEqual([]) // b 只是换了父级
    expect(diff.moved.map((m) => m.id)).toEqual(['b'])

    applyDesignDiff(s, diff)
    const root = s.getDesign()
    expect(root.children?.map((c) => c.id)).toEqual(['a', 'box', 'new-1'])
    expect(root.children?.find((c) => c.id === 'box')?.children?.map((c) => c.id)).toEqual(['b'])
    s.destroy()
  })

  it('队友改了同一节点的**另一个字段** → AI 落地不能把它一起吞掉（字段级局部落地）', () => {
    const s = store()
    const before = s.getDesign()
    // AI 这轮只给 a 加一个样式
    const after: DesignNode = {
      ...before,
      children: [{ ...before.children![0], style: { color: 'danger' } }, before.children![1]],
    }
    // 队友在我等 AI 期间改了 a 的**文案**（不是 AI 碰的字段）
    s.__applyRemoteForTests('a', (n) => ({ ...n, props: { ...n.props, text: '队友改的' } }))

    applyDesignDiff(s, diffDesign(before, after))
    const a = s.getDesign().children!.find((c) => c.id === 'a')!
    expect(a.props?.text, 'AI 只改了样式，队友改的文案必须存活').toBe('队友改的')
    expect(a.style?.color).toBe('danger')
    s.destroy()
  })

  it('字段级补丁：AI 删掉一个 style 键时，其它键（含队友新加的）不受影响', () => {
    const s = store()
    const before = s.getDesign()
    const after: DesignNode = {
      ...before,
      children: [
        { ...before.children![0], style: { color: 'primary' } }, // AI 只改 color
        before.children![1],
      ],
    }
    // 队友在 a 上加了 fontSize（AI 没碰）
    s.__applyRemoteForTests('a', (n) => ({ ...n, style: { ...n.style, fontSize: 20 } }))

    const diff = diffDesign(before, after)
    expect(Object.keys(diff.updated[0].patch.style ?? {})).toEqual(['color'])
    applyDesignDiff(s, diff)
    const a = s.getDesign().children!.find((c) => c.id === 'a')!
    expect(a.style?.color).toBe('primary')
    expect(a.style?.fontSize, '队友加的 fontSize 必须存活').toBe(20)
    s.destroy()
  })

  it('字段级补丁：props 键被删（值为 null）+ hidden 切换都能正确落地', () => {
    const s = store()
    const before = s.getDesign()
    const after: DesignNode = {
      ...before,
      children: [
        { id: 'a', type: 'text', props: {}, style: {}, hidden: true }, // 删掉 props.text 并隐藏
        before.children![1],
      ],
    }
    const diff = diffDesign(before, after)
    expect(diff.updated[0].patch.props).toEqual({ text: null })
    expect(diff.updated[0].patch.hidden).toBe(true)
    applyDesignDiff(s, diff)
    const a = s.getDesign().children!.find((c) => c.id === 'a')!
    expect(a.props?.text).toBeUndefined()
    expect(a.hidden).toBe(true)
    s.destroy()
  })

  it('删除节点：AI 删掉的会被移除（且深层优先，不报错）', () => {
    const s = store()
    const before = s.getDesign()
    const after: DesignNode = { ...before, children: [before.children![0]] }
    const diff = diffDesign(before, after)
    expect(diff.removed).toEqual(['b'])
    applyDesignDiff(s, diff)
    expect(s.getDesign().children?.map((c) => c.id)).toEqual(['a'])
    s.destroy()
  })

  it('同父级重排（把后面的模块挪到最前）必须落地——不能整条被丢掉', () => {
    const s = store()
    const before = s.getDesign() // [a, b]
    const after: DesignNode = { ...before, children: [before.children![1], before.children![0]] } // [b, a]

    applyDesignDiff(s, diffDesign(before, after))
    expect(s.getDesign().children?.map((c) => c.id)).toEqual(['b', 'a'])
    s.destroy()
  })

  it('重排 + 新增同时发生（新节点插到最前）：最终顺序必须与 AI 返回一致', () => {
    const s = store()
    const before = s.getDesign() // [a, b]
    const after: DesignNode = {
      ...before,
      children: [
        { id: 'x', type: 'text', props: { text: '新插到最前' }, style: {} },
        before.children![0],
        before.children![1],
      ],
    }

    applyDesignDiff(s, diffDesign(before, after))
    expect(s.getDesign().children?.map((c) => c.id)).toEqual(['x', 'a', 'b'])
    s.destroy()
  })

  it('根 id 不同 ⇒ 整体替换（上轮接线失败的那一类：empty → root）', () => {
    const s = store()
    const before: DesignNode = { id: 'empty', type: 'frame' } // 画布还没加载时的空稿
    const after: DesignNode = {
      id: 'root',
      type: 'frame',
      style: { layout: 'column' },
      children: [{ id: 't1', type: 'text', props: { text: 'AI 新标题' }, style: {} }],
    }

    const diff = diffDesign(before, after)
    expect(diff.replace).toEqual(after)
    expect([diff.removed, diff.moved, diff.updated, diff.added].every((x) => x.length === 0)).toBe(true)

    applyDesignDiff(s, diff)
    expect(s.getDesign().id).toBe('root')
    expect(s.getDesign().children?.[0].props?.text).toBe('AI 新标题')
    s.destroy()
  })

  it('锁定态（版面已确认）下 AI 差量仍能落地——锁的权威在服务端闸门，客户端不二次否决', () => {
    const s = store()
    s.setBeautifyLock(true)
    const before = s.getDesign()
    const after: DesignNode = {
      ...before,
      children: [{ ...before.children![0], props: { text: '服务端已放行的文案' } }, before.children![1]],
    }

    s.applyAiDiff(diffDesign(before, after))
    expect(s.getDesign().children?.[0].props?.text).toBe('服务端已放行的文案')
    // 但用户自己的直接编辑仍被锁挡住（UX 护栏没被拆掉）
    s.updateNode('a', (n) => ({ ...n, props: { ...n.props, text: '用户手改' } }))
    expect(s.getDesign().children?.[0].props?.text).toBe('服务端已放行的文案')
    s.destroy()
  })

})

/**
 * ③ 的收口（2026-09-17）：AI 基于**快照**生成，落地前必须核对"前置条件还成不成立"。
 *
 *  - 队友动了**同一个字段** → 该字段跳过（保留队友的值），其余照常落地并告知（不再静默覆盖）；
 *  - 队友动了**结构**（删了要改的节点 / 移了要删的节点 / 重排了要排序的父级）→ **整批中止**并提示
 *    （半套结构改动比不落地更难收拾）。
 */
describe('planAiLanding（AI 落地的并发前置条件）', () => {
  const aiRenamesB = (before: DesignNode): DesignNode => ({
    ...before,
    children: [before.children![0], { ...before.children![1], props: { text: 'AI 改的' } }],
  })
  const withB = (before: DesignNode, patch: Partial<DesignNode>): DesignNode => ({
    ...before,
    children: [before.children![0], { ...before.children![1], ...patch }],
  })

  it('队友改了**同一字段** → 该字段跳过、保留队友的值，其余字段照常落地', () => {
    const before = base()
    const ai = aiRenamesB(before)
    // AI 这次要改 b 的文案 + 样式；队友正好也改了文案
    const aiWithStyle: DesignNode = {
      ...ai,
      children: [ai.children![0], { ...ai.children![1], style: { color: 'danger' }, props: { text: 'AI 改的' } }],
    }
    const teammate = withB(before, { props: { text: '队友改的' } })

    const plan = planAiLanding(before, teammate, diffDesign(before, aiWithStyle))
    expect(plan.blocked).toEqual([])
    expect(plan.skipped).toEqual([{ id: 'b', fields: ['props.text'] }])

    const s = store()
    s.__applyRemoteForTests('b', (n) => ({ ...n, props: { text: '队友改的' } }))
    applyDesignDiff(s, plan.diff)
    const b = s.getDesign().children!.find((c) => c.id === 'b')!
    expect(b.props?.text, '冲突字段保留队友的版本').toBe('队友改的')
    expect(b.style?.color, '没冲突的字段照常落地').toBe('danger')
    s.destroy()
  })

  it('队友改了同节点的**另一个字段** → 不算冲突，全部落地', () => {
    const before = base()
    const ai = aiRenamesB(before)
    const teammate = withB(before, { style: { color: 'danger' } })

    const plan = planAiLanding(before, teammate, diffDesign(before, ai))
    expect(plan.blocked).toEqual([])
    expect(plan.skipped).toEqual([])
  })

  it('AI 要改的节点被队友删了 → 跳过该节点（不报错，也不把它复活）', () => {
    const before = base()
    const ai = aiRenamesB(before)
    const teammate: DesignNode = { ...before, children: [before.children![0]] } // b 没了

    const plan = planAiLanding(before, teammate, diffDesign(before, ai))
    expect(plan.blocked).toEqual([])
    expect(plan.skipped).toEqual([{ id: 'b', fields: ['props.text'] }])
    expect(plan.diff.updated).toEqual([])
  })

  it('AI 要删的节点被队友编辑过 → 结构性冲突：整批中止', () => {
    const before = base()
    const aiDeleteB: DesignNode = { ...before, children: [before.children![0]] }
    const teammate = withB(before, { props: { text: '队友刚写的' } })

    const plan = planAiLanding(before, teammate, diffDesign(before, aiDeleteB))
    expect(plan.blocked).toContain('b')
  })

  it('AI 要插入子节点的父级被队友删了 → 结构性冲突', () => {
    const before = base()
    const aiInsert: DesignNode = {
      ...before,
      children: [
        { ...before.children![0], children: [{ id: 'a-kid', type: 'text', props: { text: '新的' } }] },
        before.children![1],
      ],
    }
    const teammate: DesignNode = { ...before, children: [before.children![1]] } // a 被删

    const plan = planAiLanding(before, teammate, diffDesign(before, aiInsert))
    expect(plan.blocked.length).toBeGreaterThan(0)
  })

  it('队友把父级的顺序重排了 → AI 的排序计划被判结构冲突（不硬按旧顺序覆盖）', () => {
    const before = base()
    const aiReorder: DesignNode = { ...before, children: [before.children![1], before.children![0]] }
    const teammateReorder: DesignNode = { ...before, children: [before.children![1], before.children![0]] } // 队友先排好了

    // 队友已经把顺序改成 AI 想要的样子 → 此时"当前顺序"已与快照不同 → 判为结构冲突（让用户重发）
    const plan = planAiLanding(before, teammateReorder, diffDesign(before, aiReorder))
    expect(plan.blocked).toContain('root')
  })

  it('无并发：plan.diff 原样返回（回归保护）', () => {
    const before = base()
    const ai = aiRenamesB(before)
    const diff = diffDesign(before, ai)
    const plan = planAiLanding(before, before, diff)
    expect(plan.blocked).toEqual([])
    expect(plan.skipped).toEqual([])
    expect(plan.diff).toEqual(diff)
  })
})
