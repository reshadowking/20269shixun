/**
 * 转自由画布（P1-13）：像素级冻结的纯函数与测量公式测试。
 *
 * 注意：jsdom 没有真实布局，getBoundingClientRect 默认全 0，
 * 因此测量用例必须**注入矩形**（spyOn），不要依赖真实渲染。
 *
 * T42 隔离加固：测量用例**不再把容器挂到 document.body**（挂上去又不清理会污染后续用例，
 * 也让"测量是否只作用于传入容器"变得无法验证）。`measureChildren` 只用
 * getBoundingClientRect（注入）与 getComputedStyle，两者对 detached 元素同样有效。
 */
import { describe, expect, it, vi } from 'vitest'

import type { DesignNode } from '@/design/types'
import { freezeToFreeLayout, measureChildren, type FreezeMeasurement } from './freeze'

function child(id: string, style?: DesignNode['style']): DesignNode {
  return { id, type: 'frame', style }
}

describe('freezeToFreeLayout（纯函数）', () => {
  it('把测量结果写入 x/y 与 style.width/height', () => {
    const children = [child('a'), child('b')]
    const measurements: FreezeMeasurement[] = [
      { id: 'a', x: 24.4, y: 12.6, width: 300, height: 80 },
      { id: 'b', x: 0, y: 100, width: 200.2, height: 40 },
    ]
    const out = freezeToFreeLayout(children, measurements)
    expect(out[0].x).toBe(24)
    expect(out[0].y).toBe(13)
    expect(out[0].style?.width).toBe(300)
    expect(out[0].style?.height).toBe(80)
    expect(out[1].x).toBe(0)
    expect(out[1].y).toBe(100)
    // 宽度向上取整（防文本重新换行），高度四舍五入
    expect(out[1].style?.width).toBe(201)
    expect(out[1].style?.height).toBe(40)
  })

  it('覆盖百分比/自适应尺寸（冻结的本质），但保留其它 style 键', () => {
    const children = [child('a', { width: '100%', gap: 8, layout: 'row' })]
    const out = freezeToFreeLayout(children, [{ id: 'a', x: 0, y: 0, width: 640, height: 200 }])
    expect(out[0].style?.width).toBe(640)
    expect(out[0].style?.gap).toBe(8)
    expect(out[0].style?.layout).toBe('row')
  })

  it('测不到的节点原样保留（交由调用方提示，不静默改数据）', () => {
    const children = [child('a'), child('hidden-node', { width: 100 })]
    const out = freezeToFreeLayout(children, [{ id: 'a', x: 1, y: 2, width: 3, height: 4 }])
    expect(out[1]).toBe(children[1])
    expect(out[1].x).toBeUndefined()
  })

  it('不修改入参（无副作用）', () => {
    const children = [child('a', { width: '100%' })]
    const snapshot = JSON.stringify(children)
    freezeToFreeLayout(children, [{ id: 'a', x: 5, y: 5, width: 10, height: 10 }])
    expect(JSON.stringify(children)).toBe(snapshot)
  })
})

describe('measureChildren（公式：÷scale、只减 border）', () => {
  function setup() {
    const container = document.createElement('div')
    const parent = document.createElement('div')
    parent.setAttribute('data-node-id', 'root')
    const kidA = document.createElement('div')
    kidA.setAttribute('data-node-id', 'a')
    const kidB = document.createElement('div')
    kidB.setAttribute('data-node-id', 'b')
    parent.append(kidA, kidB)
    container.append(parent)
    // 故意不 append 到 document.body：保持用例自包含（见文件头 T42 说明）
    return { container, parent, kidA, kidB }
  }

  it('1x 缩放下按父级矩形差值计算坐标与尺寸', () => {
    const { container, parent, kidA, kidB } = setup()
    parent.getBoundingClientRect = () => ({ left: 100, top: 50, width: 800, height: 600 }) as DOMRect
    kidA.getBoundingClientRect = () => ({ left: 124, top: 74, width: 300, height: 80 }) as DOMRect
    kidB.getBoundingClientRect = () => ({ left: 124, top: 174, width: 300, height: 80 }) as DOMRect

    const { measurements, missing } = measureChildren(container, 'root', ['a', 'b'], 1)
    expect(missing).toEqual([])
    expect(measurements).toEqual([
      { id: 'a', x: 24, y: 24, width: 300, height: 80 },
      { id: 'b', x: 24, y: 124, width: 300, height: 80 },
    ])
  })

  it('2x 缩放时除以 scale（屏幕像素 → 画布单位）', () => {
    const { container, parent, kidA, kidB } = setup()
    parent.getBoundingClientRect = () => ({ left: 200, top: 100, width: 1600, height: 1200 }) as DOMRect
    // 屏幕上 48px 的偏移 = 画布 24 单位
    kidA.getBoundingClientRect = () => ({ left: 248, top: 148, width: 600, height: 160 }) as DOMRect
    kidB.getBoundingClientRect = () => ({ left: 248, top: 348, width: 600, height: 160 }) as DOMRect

    const { measurements } = measureChildren(container, 'root', ['a', 'b'], 2)
    expect(measurements[0]).toEqual({ id: 'a', x: 24, y: 24, width: 300, height: 80 })
    expect(measurements[1]).toEqual({ id: 'b', x: 24, y: 124, width: 300, height: 80 })
  })

  it('宽度向上取整（避免文本重新换行）', () => {
    const { container, parent, kidA, kidB } = setup()
    parent.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 600 }) as DOMRect
    kidA.getBoundingClientRect = () => ({ left: 0, top: 0, width: 233.2, height: 41.6 }) as DOMRect
    kidB.getBoundingClientRect = () => ({ left: 0, top: 50, width: 10, height: 10 }) as DOMRect

    const { measurements } = measureChildren(container, 'root', ['a', 'b'], 1)
    expect(measurements[0].width).toBe(234)
    expect(measurements[0].height).toBe(42)
  })

  it('父亲不存在时全部计入 missing（调用方据此中止）', () => {
    const container = document.createElement('div')
    const { measurements, missing } = measureChildren(container, 'root', ['a'], 1)
    expect(measurements).toEqual([])
    expect(missing).toEqual(['a'])
  })

  it('子节点不存在或尺寸为 0 时计入 missing', () => {
    const { container, parent, kidA, kidB } = setup()
    parent.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 600 }) as DOMRect
    kidA.getBoundingClientRect = () => ({ left: 0, top: 0, width: 0, height: 0 }) as DOMRect
    kidB.remove()

    const { measurements, missing } = measureChildren(container, 'root', ['a', 'b', 'c'], 1)
    expect(measurements).toEqual([])
    expect(missing).toEqual(['a', 'b', 'c'])
  })

  it('scale 非法（0）时回退为 1，不产生除零', () => {
    const { container, parent, kidA, kidB } = setup()
    parent.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 600 }) as DOMRect
    kidA.getBoundingClientRect = () => ({ left: 10, top: 10, width: 100, height: 20 }) as DOMRect
    kidB.getBoundingClientRect = () => ({ left: 10, top: 40, width: 100, height: 20 }) as DOMRect
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { measurements } = measureChildren(container, 'root', ['a', 'b'], 0)
    expect(measurements[0].x).toBe(10)
    spy.mockRestore()
  })

  it('T42：测量只作用于传入容器——body 里有同名 data-node-id 也不受影响', () => {
    const { container, parent, kidA, kidB } = setup()
    parent.getBoundingClientRect = () => ({ left: 100, top: 50, width: 800, height: 600 }) as DOMRect
    kidA.getBoundingClientRect = () => ({ left: 124, top: 74, width: 300, height: 80 }) as DOMRect
    kidB.getBoundingClientRect = () => ({ left: 124, top: 174, width: 300, height: 80 }) as DOMRect

    // 噪声：挂在 body 上、id 完全相同的另一棵树（模拟页面里存在缩略图/预览副本的极端情况）
    const noise = document.createElement('div')
    noise.innerHTML = '<div data-node-id="root"><div data-node-id="a"></div><div data-node-id="b"></div></div>'
    document.body.append(noise)
    try {
      const { measurements, missing } = measureChildren(container, 'root', ['a', 'b'], 1)
      expect(missing).toEqual([])
      expect(measurements).toEqual([
        { id: 'a', x: 24, y: 24, width: 300, height: 80 },
        { id: 'b', x: 24, y: 124, width: 300, height: 80 },
      ])
    } finally {
      noise.remove()
    }
  })

  it('T42：小数缩放（1.5）按公式收敛，且重复测量结果一致', () => {
    const { container, parent, kidA, kidB } = setup()
    parent.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1200, height: 900 }) as DOMRect
    kidA.getBoundingClientRect = () => ({ left: 30, top: 45, width: 450, height: 120 }) as DOMRect
    kidB.getBoundingClientRect = () => ({ left: 30, top: 165, width: 450, height: 120 }) as DOMRect

    const first = measureChildren(container, 'root', ['a', 'b'], 1.5)
    expect(first.measurements).toEqual([
      { id: 'a', x: 20, y: 30, width: 300, height: 80 },
      { id: 'b', x: 20, y: 110, width: 300, height: 80 },
    ])
    for (let i = 0; i < 20; i++) {
      expect(measureChildren(container, 'root', ['a', 'b'], 1.5)).toEqual(first)
    }
  })
})

/**
 * 2026-09-17：② 「冻结错乱」剩下两个嫌疑里**能在 jsdom 确定性验证**的部分。
 * 真实布局测量要真栈，但下面两条是纯数学性质，任何一条不成立都会导致"越冻越偏"：
 *   ① 不动点：把已冻结的结果再冻一次，必须一模一样（自动冻结会在每次 AI 落地后跑）；
 *   ② 作用域：只写直接子节点的 x/y/宽高，嵌套容器的内部一个字节都不动。
 */
/**
 * "偶发排版错乱"的机制复现（2026-09-17 二次修）。
 *
 * 图片还没 decode 完时它的盒子高度是偏小的（甚至接近 0）；此时测量并冻结，
 * 就会把这个偏小的高度写进 `style.height`——图加载完后按真实尺寸渲染，于是
 * 内容溢出/错位。所以"未落定"这件事必须能被调用方看见并据此中止，
 * 而不是超时后照旧测量（旧实现在 1200ms 超时后就是这么干的）。
 */
describe('错乱机制：测量太早 → 冻结写进偏小的高度', () => {
  function scene() {
    const container = document.createElement('div')
    const parent = document.createElement('div')
    parent.setAttribute('data-node-id', 'root')
    const kid = document.createElement('div')
    kid.setAttribute('data-node-id', 'hero')
    parent.append(kid)
    container.append(parent)
    parent.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 600 }) as DOMRect
    return { container, kid }
  }

  it('图未加载时测到 40 → 冻结写 40；图加载完后真实高度是 200（差 160，即错乱）', () => {
    const { container, kid } = scene()
    // ① 图片还没 decode 完：盒子只有 40 高
    kid.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 40 }) as DOMRect
    const early = measureChildren(container, 'root', ['hero'], 1)
    const earlyFrozen = freezeToFreeLayout([{ id: 'hero', type: 'component', componentType: 'image' }], early.measurements)
    expect(earlyFrozen[0].style?.height).toBe(40)

    // ② 图片落定：真实高度 200
    kid.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 200 }) as DOMRect
    const settled = measureChildren(container, 'root', ['hero'], 1)
    expect(settled.measurements[0].height).toBe(200)

    // 结论：两次测量的差就是被冻结进树的错误量 —— 调用方必须用 settled=false 中止
    expect(settled.measurements[0].height - (earlyFrozen[0].style?.height as number)).toBe(160)
  })
})


describe('冻结的数学性质（防"越冻越偏"）', () => {
  const measurementsOf = (nodes: DesignNode[]): FreezeMeasurement[] =>
    nodes.map((n) => ({
      id: n.id,
      x: n.x ?? 0,
      y: n.y ?? 0,
      width: Number(n.style?.width ?? 0),
      height: Number(n.style?.height ?? 0),
    }))

  it('不动点：对已冻结的树再冻一次，结果完全一致（ceil/round 不带漂移）', () => {
    const children = [
      { id: 'a', type: 'frame', style: { width: '100%', gap: 8 } },
      { id: 'b', type: 'frame', style: { width: 233.2, height: 41.6 } },
      { id: 'c', type: 'text', style: {} },
    ] as DesignNode[]
    const first = freezeToFreeLayout(children, [
      { id: 'a', x: 24.4, y: 12.6, width: 300.2, height: 80.4 },
      { id: 'b', x: 0, y: 100.6, width: 200.2, height: 40.5 },
      { id: 'c', x: 10.5, y: 200.4, width: 50.5, height: 20.5 },
    ])
    const second = freezeToFreeLayout(first, measurementsOf(first))
    expect(second).toEqual(first)
    // 再三确认：第三次也一样（重复自动冻结不允许累积误差）
    expect(freezeToFreeLayout(second, measurementsOf(second))).toEqual(first)
  })

  it('作用域：只写直接子节点；嵌套容器的内部子树原样保留', () => {
    const nested: DesignNode = {
      id: 'box',
      type: 'frame',
      style: { layout: 'column' },
      children: [{ id: 'inner-text', type: 'text', props: { text: '内层' }, style: { fontSize: 14 } }],
    }
    const children: DesignNode[] = [nested, { id: 'sibling', type: 'text', props: { text: '兄弟' }, style: {} }]

    const frozen = freezeToFreeLayout(children, [
      { id: 'box', x: 0, y: 0, width: 320, height: 200 },
      { id: 'sibling', x: 0, y: 210, width: 320, height: 24 },
    ])

    expect(frozen[0].x).toBe(0)
    expect(frozen[0].style?.width).toBe(320)
    // 内层子树必须一个字节都没动（否则"外层 free + 内层被改写"才是真的错乱来源）
    expect(frozen[0].children).toEqual(nested.children)
    expect(frozen[0].style?.layout).toBe('column')
    // 没被测到的节点原样返回
    expect(freezeToFreeLayout(children, [{ id: 'box', x: 1, y: 2, width: 3, height: 4 }])[1]).toBe(children[1])
  })
})
