/**
 * T5 批A：§4.5 残项收敛的令牌常量单一来源护栏（styleTokens.ts）。
 * 常量值必须等于令牌解析值——谁把 hex 改得与 design-system.yaml 脱钩，这里立刻红。
 * （#3/#7/#9 的"值相等、来源分叉"类残项，行为断言测不出来，靠本文件锁死来源。）
 */
import { describe, expect, it } from 'vitest'

import { resolveColor } from '@/design/styleToCss'
import {
  CHART_AXIS_COLOR,
  CHART_GRID_COLOR,
  INPUT_LABEL_COLOR,
  NAV_LINK_COLOR,
  STAT_LABEL_COLOR,
  TABLE_CELL_BORDER,
  TABLE_HEAD_BACKGROUND,
  TABLE_HEAD_TEXT_COLOR,
} from './styleTokens'

describe('T5 批A 令牌常量单一来源（styleTokens）', () => {
  it('常量值 == design-system.yaml 令牌解析值（防来源分叉回退）', () => {
    expect(CHART_AXIS_COLOR).toBe(resolveColor('text-light'))
    expect(CHART_GRID_COLOR).toBe(resolveColor('border'))
    expect(INPUT_LABEL_COLOR).toBe(resolveColor('text-primary'))
    expect(STAT_LABEL_COLOR).toBe(resolveColor('text-light'))
    expect(NAV_LINK_COLOR).toBe(resolveColor('text-light'))
    expect(TABLE_CELL_BORDER).toBe(`1px solid ${resolveColor('border')!}`)
    expect(TABLE_HEAD_TEXT_COLOR).toBe(resolveColor('text-light'))
  })

  it('表头底色由 background 令牌派生 50% 透明（等值于原 shadcn bg-muted/50）', () => {
    expect(TABLE_HEAD_BACKGROUND).toBe('rgba(245, 245, 245, 0.5)')
  })
})
