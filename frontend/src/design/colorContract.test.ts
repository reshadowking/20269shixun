/**
 * T52 批2：颜色数据契约——demoData 里所有 background/color 值必须是令牌名或白名单 hex。
 *
 * 历史教训：dashboard 演示稿曾写 background:'card'（令牌表无此名）→ 旧 resolveColor 静默放行
 * → 非法 CSS → 色块隐形且无任何报错（backend/templates.py:44 的注释自证 'card' 非令牌）。
 * 此测试防"第三处 card"再犯。
 *
 * 范围：style.background / style.color 两个语义色字段（resolveColor 的消费面）。
 * border 是复合 CSS 串（"1px solid #EEF0F4"），不在本契约内——AI 产出的合规由后端
 * 合规检查器把守，手写数据走这里。
 */
import { describe, expect, it } from 'vitest'

import { BLANK_DESIGN, DEMO_DESIGNS } from './demoData'
import { isAllowedColor } from './tokens.generated'
import type { DesignNode } from './types'

function walk(node: DesignNode, fn: (n: DesignNode) => void): void {
  fn(node)
  for (const child of node.children ?? []) walk(child, fn)
}

describe('颜色数据契约（demoData）', () => {
  it('所有 background/color 值必须是令牌名或白名单 hex（isAllowedColor）', () => {
    const bad: string[] = []
    for (const design of [BLANK_DESIGN, ...DEMO_DESIGNS]) {
      walk(design, (n) => {
        for (const key of ['background', 'color'] as const) {
          const v = n.style?.[key]
          if (typeof v === 'string' && v && !isAllowedColor('default', v)) {
            bad.push(`${n.id}.style.${key}="${v}"`)
          }
        }
      })
    }
    expect(bad, `非法颜色值（令牌表外且非白名单 hex）：${bad.join('、')}`).toEqual([])
  })

  it('历史事故值 card 不允许再出现', () => {
    const bad: string[] = []
    for (const design of [BLANK_DESIGN, ...DEMO_DESIGNS]) {
      walk(design, (n) => {
        if (n.style?.background === 'card' || n.style?.color === 'card') bad.push(n.id)
      })
    }
    expect(bad, `'card' 曾导致色块静默隐形，不得回归：${bad.join('、')}`).toEqual([])
  })
})
