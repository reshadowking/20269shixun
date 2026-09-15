/** T36：主题持久化（切页不丢、首屏应用、可切换）。 */
import { afterEach, describe, expect, it, vi } from 'vitest'

import { applyTheme, getTheme, initTheme, toggleTheme } from './theme'
import { readStorage, writeStorage } from './storage'

describe('theme', () => {
  afterEach(() => {
    localStorage.clear()
    document.documentElement.classList.remove('dark')
    vi.unstubAllGlobals()
  })

  it('显式选择优先并持久化', () => {
    applyTheme('dark')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(readStorage('design-tool-theme')).toBe('dark') // T41：断言走适配器（window 不再被写）
    expect(getTheme()).toBe('dark') // 换页面重新读取仍是 dark —— 修掉"切页变亮"

    applyTheme('light')
    expect(document.documentElement.classList.contains('dark')).toBe(false)
    expect(getTheme()).toBe('light')
  })

  it('没有显式选择时跟随系统', () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('dark') }) as MediaQueryList)
    expect(getTheme()).toBe('dark')
  })

  it('toggle 在两种主题间切换，initTheme 幂等', () => {
    applyTheme('light')
    expect(toggleTheme()).toBe('dark')
    expect(toggleTheme()).toBe('light')
    writeStorage('design-tool-theme', 'dark')
    expect(initTheme()).toBe('dark')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })
})
