import * as Y from 'yjs'
import { describe, expect, it, vi } from 'vitest'

import type { DesignNode } from '@/design/types'
import { DesignStore, duplicatePlain } from './designStore'

function sample(): DesignNode {
  return {
    id: 'root',
    type: 'frame',
    style: { layout: 'column', gap: 8 },
    children: [
      { id: 'a', type: 'text', props: { text: '标题' } },
      {
        id: 'b',
        type: 'frame',
        style: { layout: 'row' },
        children: [
          { id: 'b1', type: 'component', componentType: 'button', props: { text: '按钮' } },
          { id: 'b2', type: 'text', props: { text: '文本' } },
        ],
      },
    ],
  }
}

describe('DesignStore 基础', () => {
  it('初始化后 toJSON 与输入一致（本地模式，无 ws）', () => {
    const store = new DesignStore(undefined, sample())
    const design = store.getDesign()
    expect(design.id).toBe('root')
    expect(design.style?.layout).toBe('column')
    expect(design.children?.[1].children?.[0].componentType).toBe('button')
    expect(design.children?.[1].children?.[0].props?.text).toBe('按钮')
    store.destroy()
  })

  it('订阅：操作触发回调', () => {
    const store = new DesignStore(undefined, sample())
    let calls = 0
    const unsub = store.subscribe(() => calls++)
    store.updateNode('a', (n) => ({ ...n, props: { text: '改' } }))
    expect(calls).toBeGreaterThan(0)
    unsub()
    store.destroy()
  })
})

describe('DesignStore 操作', () => {
  it('updateNode 更新深层节点 props', () => {
    const store = new DesignStore(undefined, sample())
    store.updateNode('b1', (n) => ({ ...n, props: { ...n.props, text: '确认' } }))
    const design = store.getDesign()
    expect(design.children?.[1].children?.[0].props?.text).toBe('确认')
    store.destroy()
  })

  it('updateNode 更新 free 坐标', () => {
    const store = new DesignStore(undefined, sample())
    store.updateNode('a', (n) => ({ ...n, x: 42, y: 24 }))
    expect(store.getDesign().children?.[0].x).toBe(42)
    store.destroy()
  })

  it('removeNode 删除深层节点', () => {
    const store = new DesignStore(undefined, sample())
    store.removeNode('b1')
    const design = store.getDesign()
    expect(design.children?.[1].children?.map((c) => c.id)).toEqual(['b2'])
    store.destroy()
  })

  it('removeNode 删除根清空', () => {
    const store = new DesignStore(undefined, sample())
    store.removeNode('root')
    expect(store.getDesign().id).toBe('empty')
    store.destroy()
  })

  it('insertChild 添加到指定父节点末尾', () => {
    const store = new DesignStore(undefined, sample())
    store.insertChild('root', { id: 'new-node', type: 'text', props: { text: '新' } })
    const design = store.getDesign()
    expect(design.children?.at(-1)?.id).toBe('new-node')
    store.destroy()
  })

  it('moveChild 重排', () => {
    const store = new DesignStore(undefined, sample())
    store.moveChild('b2', 'b', 0)
    expect(store.getDesign().children?.[1].children?.map((c) => c.id)).toEqual(['b2', 'b1'])
    store.destroy()
  })

  it('moveChild 移到末尾（置底）且重复调用稳定', () => {
    const store = new DesignStore(undefined, sample())
    store.moveChild('a', 'root', 99) // 置底
    expect(store.getDesign().children?.map((c) => c.id)).toEqual(['b', 'a'])
    // 同一目标重复调用：位置不变必须跳过（防止 Yjs item 替换风暴）
    const before = Y.encodeStateAsUpdate(store.ydoc)
    store.moveChild('a', 'root', 99)
    const after = Y.encodeStateAsUpdate(store.ydoc)
    expect(after).toEqual(before)
    store.destroy()
  })

  it('moveNodeTo 跨父移动（图层管理改父级）', () => {
    const store = new DesignStore(undefined, sample())
    // 把 b2 移到 root 下
    store.moveNodeTo('b2', 'root', 0)
    const design = store.getDesign()
    expect(design.children?.map((c) => c.id)).toEqual(['b2', 'a', 'b'])
    expect(design.children?.[2].children?.map((c) => c.id)).toEqual(['b1'])
    store.destroy()
  })

  it('moveNodeTo 防循环（不能移到自己后代）', () => {
    const store = new DesignStore(undefined, sample())
    store.moveNodeTo('root', 'b1', 0) // root 移入自己的后代 → 拒绝
    expect(store.getDesign().id).toBe('root')
    store.destroy()
  })

  it('hidden 字段随节点保存与读取', () => {
    const store = new DesignStore(undefined, sample())
    store.updateNode('a', (n) => ({ ...n, hidden: true }))
    expect(store.getDesign().children?.[0].hidden).toBe(true)
    store.destroy()
  })

  it('plainToY 保留 hidden：constructor 初始化', () => {
    const initial = sample()
    initial.children![0] = { ...initial.children![0], hidden: true }
    const store = new DesignStore(undefined, initial)
    expect(store.getDesign().children?.[0].hidden).toBe(true)
    store.destroy()
  })

  it('plainToY 保留 hidden：resetDesign（打开设计/AI 重置）', () => {
    const store = new DesignStore(undefined, sample())
    store.updateNode('a', (n) => ({ ...n, hidden: true }))
    const snapshot = store.getDesign()
    store.resetDesign(snapshot)
    expect(store.getDesign().children?.[0].hidden).toBe(true)
    store.destroy()
  })

  it('plainToY 保留 hidden：duplicateNode 副本', () => {
    const store = new DesignStore(undefined, sample())
    store.updateNode('a', (n) => ({ ...n, hidden: true }))
    store.duplicateNode('a')
    const copy = store.getDesign().children?.find((c) => c.id !== 'a' && c.id.startsWith('text-'))
    expect(copy?.hidden).toBe(true)
    store.destroy()
  })

  it('plainToY 保留 hidden：moveChild 重排隐藏节点', () => {
    const store = new DesignStore(undefined, sample())
    store.updateNode('b2', (n) => ({ ...n, hidden: true }))
    store.moveChild('b2', 'b', 0)
    const moved = store.getDesign().children?.[1].children?.find((c) => c.id === 'b2')
    expect(moved?.hidden).toBe(true)
    store.destroy()
  })

  it('plainToY 保留 hidden：moveNodeTo 跨父移动隐藏节点', () => {
    const store = new DesignStore(undefined, sample())
    store.updateNode('b2', (n) => ({ ...n, hidden: true }))
    store.moveNodeTo('b2', 'root', 0)
    const moved = store.getDesign().children?.find((c) => c.id === 'b2')
    expect(moved?.hidden).toBe(true)
    store.destroy()
  })

  it('plainToY 保留 hidden：insertChild 插入带 hidden 节点', () => {
    const store = new DesignStore(undefined, sample())
    store.insertChild('root', { id: 'hidden-new', type: 'text', hidden: true })
    const inserted = store.getDesign().children?.find((c) => c.id === 'hidden-new')
    expect(inserted?.hidden).toBe(true)
    store.destroy()
  })

  it('duplicateNode 复制子树（新 id，原节点保留）', () => {
    const store = new DesignStore(undefined, sample())
    store.duplicateNode('b')
    const design = store.getDesign()
    const parentIds = design.children?.map((c) => c.id) ?? []
    // 原 b 保留 + 副本（id 以 frame- 开头）
    expect(parentIds.filter((id) => id === 'b').length).toBe(1)
    const copy = design.children?.find((c) => c.id.startsWith('frame-'))
    expect(copy).toBeTruthy()
    // 副本的子节点 id 全部重新生成（button-/text- 前缀），且与原节点不冲突
    expect(copy?.children?.map((c) => c.id)).toEqual(expect.arrayContaining([
      expect.stringMatching(/^button-/),
      expect.stringMatching(/^text-/),
    ]))
    store.destroy()
  })

  it('duplicatePlain 生成唯一新 id', () => {
    const copy = duplicatePlain(sample())
    expect(copy.id).not.toBe('root')
    expect(copy.children?.[1].id).not.toBe('b')
    expect(copy.children?.[1].children?.[0].id).not.toBe('b1')
  })
})

describe('DesignStore 双实例同步（双向 update 转发模拟 y-websocket）', () => {
  it('一个 store 修改，另一个可见', () => {
    // 共享同一个 ydoc 模拟 y-websocket 同步后的两端
    const a = new DesignStore(undefined, sample())
    const b = new DesignStore()
    // y-websocket 等价物：双向转发 update
    a.ydoc.on('update', (update: Uint8Array) => Y.applyUpdate(b.ydoc, update))
    b.ydoc.on('update', (update: Uint8Array) => Y.applyUpdate(a.ydoc, update))
    // 初始同步
    Y.applyUpdate(b.ydoc, Y.encodeStateAsUpdate(a.ydoc))

    b.updateNode('a', (n) => ({ ...n, props: { text: '协作修改' } }))
    expect(a.getDesign().children?.[0].props?.text).toBe('协作修改')
    expect(b.getDesign().children?.[0].props?.text).toBe('协作修改')

    a.removeNode('b1')
    expect(b.getDesign().children?.[1].children?.map((c) => c.id)).toEqual(['b2'])
    a.destroy()
    b.destroy()
  })
})

describe('快照撤销（E3-2）与指定位置插入（E3-3）', () => {
  it('pushSnapshot 后修改可 popSnapshot 恢复', () => {
    const store = new DesignStore(undefined, sample())
    store.pushSnapshot()
    store.updateNode('root', (n) => ({ ...n, style: { ...n.style, gap: 99 } }))
    expect(store.getDesign().style?.gap).toBe(99)
    expect(store.canUndoOptimize).toBe(true)
    expect(store.popSnapshot()).toBe(true)
    expect(store.getDesign().style?.gap).toBe(8) // 恢复为快照时的原值
    expect(store.canUndoOptimize).toBe(false)
  })

  it('无快照时 popSnapshot 返回 false', () => {
    const store = new DesignStore(undefined, sample())
    expect(store.popSnapshot()).toBe(false)
  })

  it('快照栈上限 10（最旧被丢弃）', () => {
    const store = new DesignStore(undefined, sample())
    for (let i = 0; i < 12; i++) {
      store.pushSnapshot()
      store.updateNode('root', (n) => ({ ...n, style: { ...n.style, gap: i } }))
    }
    // 连续撤销 10 次后仍是最早的第 3 次修改（gap=2），说明前 2 次快照已被挤出
    for (let i = 0; i < 9; i++) store.popSnapshot()
    const design = store.getDesign()
    expect(typeof design.style?.gap).toBe('number')
  })

  it('insertChild 支持指定 index（推荐落位）', () => {
    const store = new DesignStore(undefined, sample())
    const rootChildren = () => store.getDesign().children ?? []
    const before = rootChildren().length
    store.insertChild('root', { id: 'new-node', type: 'text', props: { text: 'x' } }, 0)
    const after = rootChildren()
    expect(after).toHaveLength(before + 1)
    expect(after[0].id).toBe('new-node')
  })
})

describe('操作级撤销/重做（P0-1 缺陷 13）', () => {
  it('updateNode 后可撤销/重做', () => {
    const store = new DesignStore(undefined, sample())
    store.updateNode('a', (n) => ({ ...n, props: { text: '改后' } }))
    expect(store.getDesign().children?.[0].props?.text).toBe('改后')
    expect(store.canUndo).toBe(true)
    expect(store.undo()).toBe(true)
    expect(store.getDesign().children?.[0].props?.text).toBe('标题')
    expect(store.canRedo).toBe(true)
    expect(store.redo()).toBe(true)
    expect(store.getDesign().children?.[0].props?.text).toBe('改后')
  })

  it('removeNode 后可撤销恢复节点', () => {
    const store = new DesignStore(undefined, sample())
    store.removeNode('b1')
    expect(store.getDesign().children?.[1].children?.map((c) => c.id)).toEqual(['b2'])
    expect(store.undo()).toBe(true)
    expect(store.getDesign().children?.[1].children?.map((c) => c.id)).toEqual(['b1', 'b2'])
  })

  it('无操作时 undo/redo 返回 false', () => {
    const store = new DesignStore(undefined, sample())
    expect(store.undo()).toBe(false)
    expect(store.redo()).toBe(false)
  })

  it('resetDesign（AI 生成/快照恢复）不入操作级撤销栈', () => {
    const store = new DesignStore(undefined, sample())
    store.updateNode('a', (n) => ({ ...n, props: { text: '本地修改' } }))
    store.resetDesign({ id: 'new', type: 'frame', style: { layout: 'row' } })
    expect(store.getDesign().id).toBe('new')
    // reset 是整树替换：旧操作失去上下文，撤销栈被清空
    expect(store.canUndo).toBe(false)
  })

  it('快照恢复（popSnapshot）不入操作级撤销栈', () => {
    const store = new DesignStore(undefined, sample())
    store.pushSnapshot()
    store.updateNode('a', (n) => ({ ...n, props: { text: 'x' } }))
    store.popSnapshot() // resetDesign(RESET_ORIGIN)
    expect(store.canUndo).toBe(false) // 快照恢复不是用户操作
  })
})

describe('D5 presence（本地模式/无 provider）', () => {
  it('在线数恒 1（自己），订阅立即回调一次，setPresence 不抛', () => {
    const store = new DesignStore(undefined, sample())
    expect(store.onlineCount).toBe(1)
    const cb = vi.fn()
    const unsub = store.subscribePresence(cb)
    expect(cb).toHaveBeenCalledTimes(1)
    expect(() => store.setPresence('alice')).not.toThrow()
    expect(store.onlineUsers).toEqual([]) // 本地模式无远端状态
    unsub()
    store.destroy()
  })

  it('subscribeStatus 无 provider 返回空清理函数（不抛）', () => {
    const store = new DesignStore(undefined, sample())
    const unsub = store.subscribeStatus(() => {})
    expect(() => unsub()).not.toThrow()
    store.destroy()
  })
})

describe('缺陷 3 美化锁定（数据写入层强制）', () => {
  const SHADOW = '0 4px 12px rgba(29,33,41,0.10)'

  function lockedStore(): DesignStore {
    const store = new DesignStore(undefined, sample())
    store.setBeautifyLock(true)
    return store
  }

  it('锁定后：位置/文本/尺寸/布局/结构改动全部被拒绝（不靠 UI 禁用）', () => {
    const store = lockedStore()
    const before = JSON.stringify(store.getDesign())

    store.updateNode('b1', (n) => ({ ...n, x: 10, y: 20 })) // 位置
    store.updateNode('b1', (n) => ({ ...n, props: { ...(n.props ?? {}), text: '改了文案' } })) // 文本
    store.updateNode('b1', (n) => ({ ...n, style: { ...(n.style ?? {}), width: 999 } })) // 尺寸
    store.updateNode('b', (n) => ({ ...n, style: { ...(n.style ?? {}), layout: 'grid' } })) // 布局
    store.updateNode('b', (n) => ({ ...n, children: [...(n.children ?? []), { id: 'new', type: 'text' }] })) // 结构

    expect(JSON.stringify(store.getDesign())).toBe(before)
  })

  it('锁定后：新增/删除/复制/排序模块被拒绝', () => {
    const store = lockedStore()
    const before = JSON.stringify(store.getDesign())
    store.insertChild('root', { id: 'x1', type: 'text' })
    store.removeNode('b1')
    store.duplicateNode('b')
    store.moveChild('a', 'root', 1)
    store.moveNodeTo('b2', 'root', 0)
    expect(JSON.stringify(store.getDesign())).toBe(before)
  })

  it('锁定后：白名单效果键允许写入（阴影/渐变/动效/圆角/描边/变换）', () => {
    const store = lockedStore()
    store.updateNode('b1', (n) => ({ ...n, style: { ...(n.style ?? {}), shadow: SHADOW } }))
    store.updateNode('b1', (n) => ({ ...n, style: { ...(n.style ?? {}), radius: 16 } }))
    store.updateNode('b1', (n) => ({ ...n, style: { ...(n.style ?? {}), animation: 'fade-in' } }))
    const target = store.getDesign().children!.find((c) => c.id === 'b')!.children!.find((c) => c.id === 'b1')!
    expect(target.style?.shadow).toBe(SHADOW)
    expect(target.style?.radius).toBe(16)
    expect(target.style?.animation).toBe('fade-in')
    expect(target.style?.width).toBeUndefined() // 别的字段没被动
  })

  it('批量更新：任一项越权则整批拒绝（原子语义）', () => {
    const store = lockedStore()
    const before = JSON.stringify(store.getDesign())
    store.updateMany(['a', 'b1'], (n) => ({ ...n, props: { ...(n.props ?? {}), text: '批量改' } }))
    expect(JSON.stringify(store.getDesign())).toBe(before)
  })

  it('解除锁定后恢复可编辑', () => {
    const store = lockedStore()
    store.setBeautifyLock(false)
    store.updateNode('b1', (n) => ({ ...n, props: { ...(n.props ?? {}), text: '可以改了' } }))
    const target = store.getDesign().children!.find((c) => c.id === 'b')!.children!.find((c) => c.id === 'b1')!
    expect(target.props?.text).toBe('可以改了')
  })

  it('越权写入触发 blocked 回调（UI 据此提示），返回值不抛错', () => {
    const store = lockedStore()
    const reasons: string[] = []
    const unsub = store.subscribeBlocked((r) => reasons.push(r))
    expect(() => store.updateNode('b1', (n) => ({ ...n, x: 1 }))).not.toThrow()
    expect(() => store.removeNode('b1')).not.toThrow()
    expect(reasons).toHaveLength(2)
    expect(reasons[0]).toContain('版面已确认')
    unsub()
  })

  it('锁定不影响整树重置通道（AI 生成/快照恢复走 resetDesign）', () => {
    const store = lockedStore()
    const next: DesignNode = { id: 'root', type: 'frame', style: { layout: 'row' }, children: [{ id: 'z', type: 'text' }] }
    store.resetDesign(next)
    expect(store.getDesign().children?.[0].id).toBe('z')
  })
})

describe('缺陷 3 锁定阶段的可写样式白名单', () => {
  it('颜色/背景在锁定期仍可改（样式类属性），但布局/文本/尺寸不行', () => {
    const store = new DesignStore(undefined, sample())
    store.setBeautifyLock(true)
    store.updateNode('a', (n) => ({ ...n, style: { ...(n.style ?? {}), color: 'primary', background: '#FFF0F0' } }))
    const node = store.getDesign().children!.find((c) => c.id === 'a')!
    expect(node.style?.color).toBe('primary')
    expect(node.style?.background).toBe('#FFF0F0')

    store.updateNode('a', (n) => ({ ...n, style: { ...(n.style ?? {}), fontSize: 40 } }))
    expect(store.getDesign().children!.find((c) => c.id === 'a')!.style?.fontSize).toBeUndefined()
  })
})

/**
 * P1-13 转自由画布（像素级冻结）：单事务 + 单撤销步 + 锁定期拒绝。
 * 回归的是历史缺陷：updateNode + updateMany 两次调用会产生两个撤销步，
 * 撤销后只剩 layout:'free' 而坐标被回滚，子节点会全部堆到左上角。
 */
describe('P1-13 convertToFreeLayout', () => {
  const updates = [
    { id: 'a', x: 24, y: 24, width: 300, height: 60 },
    { id: 'b', x: 24, y: 100, width: 300, height: 200 },
  ]

  it('父容器转 free 并冻结子节点位置/尺寸', () => {
    const store = new DesignStore(undefined, sample())
    const before = JSON.stringify(store.getDesign())
    const result = store.convertToFreeLayout('root', updates)
    expect(result.ok).toBe(true)

    const design = store.getDesign()
    expect(design.style?.layout).toBe('free')
    const a = design.children!.find((c) => c.id === 'a')!
    const b = design.children!.find((c) => c.id === 'b')!
    expect([a.x, a.y, a.style?.width, a.style?.height]).toEqual([24, 24, 300, 60])
    expect([b.x, b.y, b.style?.width, b.style?.height]).toEqual([24, 100, 300, 200])
    expect(JSON.stringify(store.getDesign())).not.toBe(before)
    store.destroy()
  })

  it('一次 Ctrl+Z 完整还原（不允许出现 layout:free + 坐标被回滚的坏状态）', () => {
    const store = new DesignStore(undefined, sample())
    const before = JSON.stringify(store.getDesign())
    store.convertToFreeLayout('root', updates)
    expect(store.canUndo).toBe(true)

    expect(store.undo()).toBe(true)
    const after = store.getDesign()
    expect(JSON.stringify(after)).toBe(before)
    expect(after.style?.layout).toBe('column')
    expect(after.children!.find((c) => c.id === 'a')!.x).toBeUndefined()
    store.destroy()
  })

  it('版面锁定时拒绝，且画布不变', () => {
    const store = new DesignStore(undefined, sample())
    store.setBeautifyLock(true)
    const before = JSON.stringify(store.getDesign())
    const result = store.convertToFreeLayout('root', updates)
    expect(result).toEqual({ ok: false, reason: 'locked' })
    expect(JSON.stringify(store.getDesign())).toBe(before)
    store.destroy()
  })

  it('子节点 id 不存在时跳过该条，不影响其余节点', () => {
    const store = new DesignStore(undefined, sample())
    const result = store.convertToFreeLayout('root', [...updates, { id: 'ghost', x: 1, y: 1, width: 1, height: 1 }])
    expect(result.ok).toBe(true)
    expect(store.getDesign().children!.find((c) => c.id === 'a')!.x).toBe(24)
    store.destroy()
  })

  it('父节点不存在时返回未成功，不改动设计树', () => {
    const store = new DesignStore(undefined, sample())
    const before = JSON.stringify(store.getDesign())
    const result = store.convertToFreeLayout('no-such-parent', updates)
    expect(result.ok).toBe(false)
    expect(JSON.stringify(store.getDesign())).toBe(before)
    store.destroy()
  })
})
