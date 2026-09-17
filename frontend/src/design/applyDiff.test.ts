/**
 * AI 差量落地（2026-09-17）。最重要的一条是**并发保命**：
 * 请求发出到落地之间，队友改过的"未被 AI 碰过的节点"必须存活——
 * 原来的整树替换会把它们一起吞掉。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { DesignNode } from '@/design/types'
import { DesignStore } from '@/yjs/designStore'

import { applyDesignDiff, diffDesign } from './applyDiff'

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
