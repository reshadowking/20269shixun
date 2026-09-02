import { describe, expect, it } from 'vitest'

import { escapeHtml, safeHref } from './escape'

describe('escapeHtml（导出通道 XSS 防线）', () => {
  it('转义全部危险字符', () => {
    expect(escapeHtml('<script>alert(1)</script>')).toBe('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(escapeHtml('"><img onerror=alert(1)>')).toBe('&quot;&gt;&lt;img onerror=alert(1)&gt;')
    expect(escapeHtml("it's")).toBe('it&#39;s')
    expect(escapeHtml('a & b')).toBe('a &amp; b')
  })

  it('普通文本不受影响', () => {
    expect(escapeHtml('优惠券 618 活动')).toBe('优惠券 618 活动')
  })

  it('转义后无残留可执行标签', () => {
    const out = escapeHtml('</div><script>alert(document.cookie)</script>')
    expect(out).not.toContain('<script>')
    expect(out).not.toContain('</div>')
  })
})

describe('safeHref（href 协议白名单）', () => {
  it('允许 http/https/mailto/锚点/相对路径', () => {
    expect(safeHref('https://example.com')).toBe('https://example.com')
    expect(safeHref('http://a.b/c')).toBe('http://a.b/c')
    expect(safeHref('mailto:a@b.com')).toBe('mailto:a@b.com')
    expect(safeHref('#section')).toBe('#section')
    expect(safeHref('/static/images/a.png')).toBe('/static/images/a.png')
    expect(safeHref('./about')).toBe('./about')
  })

  it('拒绝 javascript:/data:/vbscript: 协议', () => {
    expect(safeHref('javascript:alert(1)')).toBe('#')
    expect(safeHref('JaVaScRiPt:alert(1)')).toBe('#')
    expect(safeHref('data:text/html,<script>alert(1)</script>')).toBe('#')
    expect(safeHref('vbscript:msgbox(1)')).toBe('#')
    expect(safeHref(undefined)).toBe('#')
    expect(safeHref('')).toBe('#')
  })
})
