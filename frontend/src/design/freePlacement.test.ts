/**
 * 孤儿节点补位（2026-09-18）：free 父级下没有坐标的子节点要排到最下方、不压人。
 */
import { describe, expect, it } from 'vitest'

import type { DesignNode } from './types'
import { placeUnpositionedChildren } from './freePlacement'

const leaf = (id: string, y?: number, height = 40): DesignNode => ({
  id,
  type: 'component',
  componentType: 'button',
  props: { text: id },
  ...(y === undefined ? {} : { x: 24, y }),
  style: { width: 120, height },
})

const freeRoot = (children: DesignNode[], extra: Record<string, unknown> = {}): DesignNode => ({
  id: 'root',
  type: 'frame',
  style: { layout: 'free', width: 600, height: 400, padding: 16, ...extra },
  children,
})

describe('placeUnpositionedChildren', () => {
  it('给缺坐标的节点补到已有兄弟下方（复现 E2E 那一组数字）', () => {
    const out = placeUnpositionedChildren(freeRoot([leaf('a', 24), leaf('new1')]))
    const a = out.children!.find((c) => c.id === 'a')!
    const orphan = out.children!.find((c) => c.id === 'new1')!
    expect([a.x, a.y]).toEqual([24, 24])
    expect(orphan.x).toBe(16) // 父级 padding 左
    expect(orphan.y).toBe(72) // 24 + 40(高) + 8(gap)
  })

  it('多个孤儿依次往下排，互不重叠', () => {
    const out = placeUnpositionedChildren(freeRoot([leaf('a', 0, 40), leaf('b'), leaf('c')]))
    const [, b, c] = out.children!
    expect(b.y).toBe(48) // 0 + 40 + 8
    expect(c.y).toBe(96) // 48 + 40 + 8
  })

  it('幂等：全部都有坐标时原样返回（连对象引用都不变）', () => {
    const design = freeRoot([leaf('a', 24), leaf('b', 80)])
    expect(placeUnpositionedChildren(design)).toBe(design)
  })

  it('非 free 父级不插手（flex 有自己的排版）', () => {
    const flex: DesignNode = {
      id: 'root',
      type: 'frame',
      style: { layout: 'column', gap: 8 },
      children: [leaf('a'), leaf('b')],
    }
    expect(placeUnpositionedChildren(flex)).toBe(flex)
  })

  it('递归：嵌套 free 容器里的孤儿也要补', () => {
    const inner = freeRoot([leaf('x', 0, 30), leaf('y')], { })
    inner.id = 'inner'
    const out = placeUnpositionedChildren(freeRoot([leaf('a', 0, 40), inner]))
    const innerOut = out.children!.find((c) => c.id === 'inner')!
    const y = innerOut.children!.find((c) => c.id === 'y')!
    expect(y.y).toBe(38) // 0 + 30 + 8
  })

  it('只缺一个轴：已有的那个轴保留', () => {
    const partial: DesignNode = { ...leaf('p'), x: 200 }
    delete (partial as { y?: number }).y
    const out = placeUnpositionedChildren(freeRoot([leaf('a', 24), partial]))
    const p = out.children!.find((c) => c.id === 'p')!
    expect(p.x).toBe(200)
    expect(p.y).toBe(72)
  })

  it('补位后内容超出父容器显式高度 → 只把高度改大（从不缩小）', () => {
    const out = placeUnpositionedChildren(freeRoot([leaf('a', 360, 40), leaf('b')], { height: 400 }))
    // a 的下沿 400，b 排到 408，b 的下沿 448，再加 padding 16 → 464
    expect(out.style?.height).toBe(464)
  })

  it('父容器没有显式高度时不动高度（auto 会自己撑开）', () => {
    const design = freeRoot([leaf('a', 360, 40), leaf('b')])
    delete (design.style as { height?: number }).height
    const out = placeUnpositionedChildren(design)
    expect(out.style?.height).toBeUndefined()
  })
})
