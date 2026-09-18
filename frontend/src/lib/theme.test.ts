/** T36：主题持久化（切页不丢、首屏应用、可切换）。 */
import { afterEach, describe, expect, it, vi } from 'vitest'

import { applyTheme, getTheme, initTheme, toggleTheme } from './theme'
import { __setStorageForTests, createMemoryStorage, readStorage, writeStorage } from './storage'

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

  /**
   * 2026-09-18：工作台此前自己存 `design-dark`，与全局的 `design-tool-theme` 是**两份**，
   * 两边都去改 `<html class="dark">` —— 首页开深色再进工作台会被工作台那份（默认浅色）摘掉，
   * 回到首页按钮还写着"浅色模式"但页面已经变亮。现在只有一份存储，老键只读一次做迁移。
   */
  it('迁移旧键 design-dark：用户以前的深色选择不丢', () => {
    // setup.ts 每个用例注入的是**内存存储**，localStorage.clear() 清不到它——要直接换后端
    __setStorageForTests(createMemoryStorage({ 'design-dark': '1' }))
    expect(getTheme()).toBe('dark')
    // getTheme 只负责"读"，贴到 <html> 由 applyTheme/initTheme 负责（首屏 main.tsx 会调）
    applyTheme(getTheme())
    expect(document.documentElement.classList.contains('dark')).toBe(true)

    __setStorageForTests(createMemoryStorage({ 'design-dark': '0' }))
    expect(getTheme()).toBe('light')
  })

  it('新键优先于旧键（迁移只在没有显式选择时生效，且不再写回旧键）', () => {
    __setStorageForTests(createMemoryStorage({ 'design-dark': '1' }))
    applyTheme('light')
    expect(getTheme()).toBe('light')
    expect(readStorage('design-dark')).toBe('1') // 旧键保持原样，不再被产品写
  })
})
