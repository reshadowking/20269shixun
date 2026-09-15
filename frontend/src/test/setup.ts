import '@testing-library/jest-dom/vitest'

import { afterEach, beforeEach, vi } from 'vitest'

import { __setStorageForTests, createMemoryStorage } from '@/lib/storage'

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
  // T41：每个用例用全新的内存存储后端——不动 window.localStorage，也不继承上一个用例的痕迹
  __setStorageForTests(createMemoryStorage())
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
  // T42：清掉用例自己手动 append 的残留节点。
  // 背景：几何/测量类用例（freeze）曾把容器挂到 document.body 且从不清理，
  // 于是"测量是否只作用于传入容器"无法被验证，全局查询（document.querySelector）
  // 也可能命中上一个用例的树。RTL 的卸载由它自己的 cleanup 负责（先于本钩子执行），
  // 这里兜住直连 DOM 的用例。
  try {
    document.body.replaceChildren()
  } catch {
    /* 忽略 */
  }
  // T41：还原被 stub 的全局对象与 mock，避免泄漏到下一个用例/文件
  try {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  } catch {
    /* 忽略 */
  }
  __setStorageForTests(null)
})
