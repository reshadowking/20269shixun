/**
 * styleToCss 转换测试（R1：padding/spacing 契约闭合的回归防线）。
 * 背景：schema 旧键为 spacing，但模板/组件库/优化器/LLM 输出实际使用 padding，
 * 此前 padding 落入 rest 后被静默丢弃（画布与导出内边距失效）。此处钉死双键语义。
 */
import { describe, expect, it, vi } from 'vitest'

import { isAllowedColor } from './tokens.generated'
import { styleToCss, resolveColor, isCssColorKeyword } from './styleToCss'

describe('resolveColor 未知值分流（T52 批2：静默失效修复）', () => {
  it('CSS 关键词：可渲染（resolveColor 放行）但被 isAllowedColor 拒——两个函数的有意分歧', () => {
    // 分歧是设计：PropertyPanel 提示管"规范策略"（isAllowedColor），resolveColor 管"可渲染性"。
    // 提示已按 isCssColorKeyword 豁免；此断言钉住分歧本身，防止有人"顺手统一"两个函数。
    for (const kw of ['transparent', 'none', 'inherit', 'currentcolor']) {
      expect(isCssColorKeyword(kw)).toBe(true)
      expect(isAllowedColor('default', kw)).toBe(false)
    }
  })

  it('未知裸词（想写令牌但拼错）→ undefined + dev 警告，不再原样放行成非法 CSS', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      expect(resolveColor('card')).toBeUndefined()
      expect(warn).toHaveBeenCalledOnce()
      expect(warn.mock.calls[0][0]).toContain('card')
    } finally {
      warn.mockRestore()
    }
  })

  it('hex / 函数值（渐变）/ CSS 关键词原样放行（合法 CSS，不误伤）', () => {
    expect(resolveColor('#FFFFFF')).toBe('#FFFFFF')
    expect(resolveColor('linear-gradient(135deg, #0052D9 0%, #7C4DFF 100%)')).toContain('linear-gradient')
    expect(resolveColor('transparent')).toBe('transparent')
  })

  it('令牌名照常解析', () => {
    expect(resolveColor('primary')).toBe('#0052D9')
    expect(resolveColor('text-light')).toBe('#5F6B7A')
  })
})

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

describe('缺陷 3 高级效果渲染（styleToCss）', () => {
  it('阴影映射 boxShadow，变换映射 transform', () => {
    const css = styleToCss({ shadow: '0 4px 12px rgba(29,33,41,0.10)', transform: 'scale(1.04)' })
    expect(css.boxShadow).toBe('0 4px 12px rgba(29,33,41,0.10)')
    expect(css.transform).toBe('scale(1.04)')
  })

  it('动效预置名补全为完整 animation（只写名字不会生效）', () => {
    expect(styleToCss({ animation: 'fade-in' }).animation).toBe('fade-in 0.6s ease-out both')
    expect(styleToCss({ animation: 'pulse-soft' }).animation).toBe('pulse-soft 2.4s ease-in-out infinite')
    expect(styleToCss({ animation: 'unknown-anim' }).animation).toBeUndefined()
  })

  it('渐变背景可渲染，非渐变/注入值被忽略', () => {
    expect(styleToCss({ backgroundImage: 'linear-gradient(135deg, #0052D9 0%, #7C4DFF 100%)' }).backgroundImage).toBe(
      'linear-gradient(135deg, #0052D9 0%, #7C4DFF 100%)',
    )
    expect(styleToCss({ backgroundImage: 'url(http://evil/x.png)' }).backgroundImage).toBeUndefined()
    expect(styleToCss({ backgroundImage: 'linear-gradient(red 0%; background: url(x))' }).backgroundImage).toBeUndefined()
  })

  it('注入形状的值不渲染（分号/花括号/引号）', () => {
    expect(styleToCss({ transform: 'scale(1); background: red' }).transform).toBeUndefined()
    expect(styleToCss({ shadow: '0 0 0 red' }).boxShadow).toBe('0 0 0 red') // shadow 值本身由白名单把关
  })
})
