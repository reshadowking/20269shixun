import '@testing-library/jest-dom/vitest'

import { afterEach, beforeEach } from 'vitest'

/**
 * T39：全局测试隔离加固。
 *
 * 背景：全量跑时出现过三次"偶发红"（freeze / geometryAudit / followup+theme），共同点是
 * 都读 localStorage 或 DOM 测量——单独跑必过、重跑必过，属跨用例残留状态导致的不稳定。
 * 这里在**每个用例前**显式重置环境敏感状态（不依赖各用例自己的 afterEach），
 * 让结果只取决于用例本身。
 */
/** 某些用例会把 localStorage 换成 spy（断言调用次数）——此时不要替它清空，否则会污染它的记录。 */
function isMocked(fn: unknown): boolean {
  return Boolean((fn as { _isMockFunction?: boolean } | undefined)?._isMockFunction)
}

beforeEach(() => {
  try {
    if (!isMocked(localStorage.clear)) localStorage.clear()
    if (!isMocked(sessionStorage.clear)) sessionStorage.clear()
  } catch {
    /* 非浏览器环境忽略 */
  }
  document.documentElement.classList.remove('dark')
  document.body.className = ''
})

afterEach(() => {
  // 兜底：即便某个用例忘了清理，也不把状态留给下一个用例
  try {
    if (!isMocked(localStorage.clear)) localStorage.clear()
  } catch {
    /* 忽略 */
  }
  document.documentElement.classList.remove('dark')
})
