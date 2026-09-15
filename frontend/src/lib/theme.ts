/**
 * T36：全局主题（深色科技感）。
 *
 * 背景：`index.css` 里本来就有 `.dark` 令牌，但**没有任何地方切换它**——所以此前"暗色模式"
 * 既不会跟随设计稿、也不会在页面间保持（切到 API 配置页就变回亮色）。这里补上最小实现：
 * `<html class="dark">` + localStorage 持久化，首屏渲染前应用，避免闪白。
 */
const THEME_KEY = 'design-tool-theme'

import { readStorage, writeStorage } from './storage'

export type AppTheme = 'light' | 'dark'

function stored(): AppTheme | null {
  const value = readStorage(THEME_KEY)
  return value === 'light' || value === 'dark' ? value : null
}

/** 当前主题：优先用户显式选择，其次跟随系统。 */
export function getTheme(): AppTheme {
  const saved = stored()
  if (saved) return saved
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light'
}

/** 应用主题并持久化（所有页面共用一份，切页不再丢）。 */
export function applyTheme(theme: AppTheme): AppTheme {
  document.documentElement.classList.toggle('dark', theme === 'dark')
  writeStorage(THEME_KEY, theme) // 写不进去（隐私模式/配额）也不影响本次生效
  return theme
}

/** 首屏调用：把持久化的主题贴到 <html> 上（main.tsx 在 render 前调用，避免闪白）。 */
export function initTheme(): AppTheme {
  return applyTheme(getTheme())
}

export function toggleTheme(): AppTheme {
  return applyTheme(document.documentElement.classList.contains('dark') ? 'light' : 'dark')
}
