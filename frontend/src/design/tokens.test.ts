import { describe, expect, it } from 'vitest'
import { ALLOWED_HEX_COLORS, isAllowedColor, nearestToken } from './tokens.generated'

describe('tokens.generated', () => {
  it('白名单色通过', () => {
    expect(ALLOWED_HEX_COLORS).toContain('#FF6B6B')
    expect(isAllowedColor('default', '#FF6B6B')).toBe(true)
    expect(isAllowedColor('default', '#FFFFFF')).toBe(true)
  })
  it('hex 大小写不敏感', () => {
    expect(isAllowedColor('default', '#ff6b6b')).toBe(true)
    expect(isAllowedColor('default', '#0052d9')).toBe(true)
    expect(isAllowedColor('default', '#fff0f0')).toBe(true)
  })
  it('令牌色通过', () => {
    expect(isAllowedColor('default', '#0052D9')).toBe(true)
    expect(isAllowedColor('default', 'primary')).toBe(true)
  })
  it('非令牌色拒绝', () => {
    expect(isAllowedColor('default', '#123456')).toBe(false)
  })
  it('nearestToken 返回建议', () => {
    expect(typeof nearestToken('default', '#123456')).toBe('string')
  })
})
