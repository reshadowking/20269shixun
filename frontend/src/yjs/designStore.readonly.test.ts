/**
 * T46a-3e：只读访客（viewer）在**数据层**被硬拦。
 *
 * 这一层的意义：网关（服务端）虽然会丢弃 viewer 的写消息，但"拖完发现没动"体验很糟、
 * 也分不清是网络问题还是权限问题。写方法统一走 _blockedByRole → 拒绝 + 广播可读原因。
 */
import { describe, expect, it } from 'vitest'

import type { DesignNode } from '@/design/types'

import { DesignStore } from './designStore'

function sample(): DesignNode {
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

function viewerStore() {
  const store = new DesignStore(undefined, sample())
  store.setReadOnly(true)
  return store
}

describe('T46a-3e：只读访客的写入全部被拒', () => {
  it('默认不是只读（既有行为不变）', () => {
    const store = new DesignStore(undefined, sample())
    expect(store.isReadOnly).toBe(false)
    store.destroy()
  })

  it('updateNode / updateMany 不改文档，并广播可读原因', () => {
    const store = viewerStore()
    const reasons: string[] = []
    store.subscribeBlocked((r) => reasons.push(r))

    store.updateNode('a', (n) => ({ ...n, props: { text: '被改' } }))
    store.updateMany(['a', 'b'], (n) => ({ ...n, props: { text: '被批量改' } }))

    expect(store.getDesign().children?.[0].props?.text).toBe('标题')
    expect(reasons).toHaveLength(2)
    expect(reasons[0]).toContain('只读访客')
    store.destroy()
  })

  it('结构改动（添加/删除/复制/跨父移动/排序）全部被拒', () => {
    const store = viewerStore()
    store.insertChild('root', { id: 'c', type: 'text', props: { text: '新增' } })
    store.removeNode('a')
    store.duplicateNode('b')
    store.moveNodeTo('a', 'b', 0)
    store.moveChild('b', 'root', 0)

    const design = store.getDesign()
    expect(design.children?.map((c) => c.id)).toEqual(['a', 'b'])
    expect(design.children?.[0].props?.text).toBe('标题')
    store.destroy()
  })

  it('转自由画布被拒且返回原因', () => {
    const store = viewerStore()
    const res = store.convertToFreeLayout('root', [{ id: 'a', x: 10, y: 10, width: 100, height: 40 }])
    expect(res).toEqual({ ok: false, reason: 'read-only' })
    expect(store.getDesign().style?.layout).toBe('column')
    store.destroy()
  })

  it('撤销优化（快照回滚）被拒', () => {
    const store = viewerStore()
    store.pushSnapshot()
    expect(store.popSnapshot()).toBe(false)
    expect(store.canUndoOptimize).toBe(true) // 快照还在（只是没被消费）
    store.destroy()
  })

  it('解除只读后写入恢复（同一实例）', () => {
    const store = viewerStore()
    store.setReadOnly(false)
    store.updateNode('a', (n) => ({ ...n, props: { text: '可以改了' } }))
    expect(store.getDesign().children?.[0].props?.text).toBe('可以改了')
    store.destroy()
  })
})
