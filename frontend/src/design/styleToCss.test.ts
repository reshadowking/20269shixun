/**
 * styleToCss 转换测试（R1：padding/spacing 契约闭合的回归防线）。
 * 背景：schema 旧键为 spacing，但模板/组件库/优化器/LLM 输出实际使用 padding，
 * 此前 padding 落入 rest 后被静默丢弃（画布与导出内边距失效）。此处钉死双键语义。
 */
import { describe, expect, it } from 'vitest'

import { styleToCss } from './styleToCss'

describe('内边距双键契约（padding 优先，spacing 回退）', () => {
  it('padding 生效', () => {
    expect(styleToCss({ padding: 24 }).padding).toBe(24)
  })

  it('spacing 回退生效', () => {
    expect(styleToCss({ spacing: 16 }).padding).toBe(16)
  })

  it('双键并存时 padding 优先', () => {
    expect(styleToCss({ padding: 24, spacing: 16 }).padding).toBe(24)
  })

  it('两者皆缺不产生 padding', () => {
    expect(styleToCss({ gap: 8 }).padding).toBeUndefined()
  })
})

describe('既有映射不回归', () => {
  it('radius → borderRadius', () => {
    expect(styleToCss({ radius: 12 }).borderRadius).toBe(12)
  })

  it('令牌色解析为色值，非令牌原样保留', () => {
    expect(styleToCss({ color: 'primary' }).color).toBe('#0052D9')
    expect(styleToCss({ color: '#FF6B6B' }).color).toBe('#FF6B6B')
  })

  it('row 布局 → flex + flexDirection', () => {
    const css = styleToCss({ layout: 'row', gap: 16 })
    expect(css.display).toBe('flex')
    expect(css.flexDirection).toBe('row')
    expect(css.gap).toBe(16)
  })

  it('backgroundImage 协议白名单：data:image 通过、javascript: 丢弃', () => {
    const ok = styleToCss({ backgroundImage: 'data:image/png;base64,AAA' })
    expect(ok.backgroundImage).toContain('url("data:image/png')
    const bad = styleToCss({ backgroundImage: 'javascript:alert(1)' })
    expect(bad.backgroundImage).toBeUndefined()
  })
})
