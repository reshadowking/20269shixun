import { describe, expect, it } from 'vitest'

import { alignFlex, alignFlexGap, alignFree, type NodeRect } from './align'

const nodes: NodeRect[] = [
  { id: 'a', x: 10, y: 10, w: 100, h: 50 },
  { id: 'b', x: 200, y: 100, w: 80, h: 30 },
  { id: 'c', x: 50, y: 200, w: 120, h: 60 },
]

describe('alignFree：水平对齐', () => {
  it('左对齐：x 统一为最小 x', () => {
    const out = alignFree(nodes, 'left')
    expect(out.a.x).toBe(10)
    expect(out.b.x).toBe(10)
    expect(out.c.x).toBe(10)
  })

  it('右对齐：右缘统一', () => {
    const out = alignFree(nodes, 'right')
    const right = 200 + 80 // max(x + w) = b
    expect(out.a.x).toBe(right - 100)
    expect(out.b.x).toBe(200)
    expect(out.c.x).toBe(right - 120)
  })

  it('水平居中：中心线统一', () => {
    const out = alignFree(nodes, 'hcenter')
    const center = (10 + 280) / 2 // (minX + maxRight)/2 = 145
    expect(out.a.x).toBe(center - 50)
    expect(out.b.x).toBe(center - 40)
    expect(out.c.x).toBe(center - 60)
  })
})

describe('alignFree：垂直对齐', () => {
  it('顶对齐 / 底对齐 / 垂直居中', () => {
    const top = alignFree(nodes, 'top')
    expect(top.b.y).toBe(10)
    expect(top.c.y).toBe(10)

    const bottom = alignFree(nodes, 'bottom')
    const bottomY = 200 + 60 // max(y + h) = c
    expect(bottom.a.y).toBe(bottomY - 50)
    expect(bottom.c.y).toBe(200)

    const vcenter = alignFree(nodes, 'vcenter')
    const centerY = (10 + 260) / 2
    expect(vcenter.a.y).toBe(centerY - 25)
    expect(vcenter.b.y).toBe(centerY - 15)
  })
})

describe('alignFree：分布', () => {
  it('水平等间距：两端不动，中间均匀（按 x 排序：a=10, c=50, b=200）', () => {
    const out = alignFree(nodes, 'hspace')
    expect(out.a.x).toBe(10)            // 最左不动
    expect(out.c.x).toBe(10 + (280 - 10) / 2) // 中间节点 c
    expect(out.b.x).toBe(280 - 80)      // 最右：右缘对齐
  })

  it('垂直等间距（按 y 排序：a=10, b=100, c=200，中间节点 b 左上角均匀分布）', () => {
    const out = alignFree(nodes, 'vspace')
    expect(out.a.y).toBe(10)
    expect(out.b.y).toBe(10 + (260 - 10) / 2) // 中间点左上角
    expect(out.c.y).toBe(200)
  })
})

describe('alignFree：统一尺寸', () => {
  it('取最大宽高', () => {
    const out = alignFree(nodes, 'uniform')
    expect(out.a.w).toBe(120)
    expect(out.a.h).toBe(60)
    expect(out.b.w).toBe(120)
    expect(out.b.h).toBe(60)
  })
})

describe('alignFree：边界', () => {
  it('少于 2 个节点返回空', () => {
    expect(alignFree([nodes[0]], 'left')).toEqual({})
    expect(alignFree([], 'left')).toEqual({})
  })
})

describe('alignFlex：父容器样式', () => {
  it('水平对齐映射 justify-content', () => {
    expect(alignFlex('left')).toEqual({ justify: 'flex-start' })
    expect(alignFlex('right')).toEqual({ justify: 'flex-end' })
    expect(alignFlex('hcenter')).toEqual({ justify: 'center' })
  })

  it('垂直对齐映射 align-items', () => {
    expect(alignFlex('top')).toEqual({ alignItems: 'flex-start' })
    expect(alignFlex('bottom')).toEqual({ alignItems: 'flex-end' })
    expect(alignFlex('vcenter')).toEqual({ alignItems: 'center' })
  })

  it('分布/统一尺寸在 flex 下返回 null（gap 由布局间距负责）', () => {
    expect(alignFlex('hspace')).toBeNull()
    expect(alignFlex('uniform')).toBeNull()
    expect(alignFlexGap('hspace')).toBe(0)
    expect(alignFlexGap('left')).toBeNull()
  })
})
