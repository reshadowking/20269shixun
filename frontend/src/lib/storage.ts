/**
 * T41：统一的本地存储适配器（可注入）。
 *
 * 背景：测试里多处直接替换 `window.localStorage`（或用 spy 统计调用次数），跨文件残留导致
 * "单独跑必过、全量偶发红"（freeze / geometryAudit / followup+theme / localStore 都出现过）。
 * 单靠 setup 里清 localStorage 治不干净——因为泄漏的是**被替换的 storage 对象本身**。
 *
 * 现在把"存哪里"收敛成一个后端：运行期用 localStorage，测试用 `__setStorageForTests()`
 * 注入内存实现，不再动 `window`。
 */
export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

/** 内存兜底（无 window / 隐私模式 / 测试注入后清空时使用）。 */
export function createMemoryStorage(seed: Record<string, string> = {}): StorageLike {
  const map = new Map<string, string>(Object.entries(seed))
  return {
    getItem: (key) => (map.has(key) ? (map.get(key) as string) : null),
    setItem: (key, value) => {
      map.set(key, value)
    },
    removeItem: (key) => {
      map.delete(key)
    },
  }
}

let override: StorageLike | null = null

function browserStorage(): StorageLike | null {
  try {
    return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null
  } catch {
    return null // 隐私模式下访问 localStorage 可能抛错
  }
}

function backend(): StorageLike {
  return override ?? browserStorage() ?? createMemoryStorage()
}

/** 仅供测试：注入/清空存储后端（不动 window）。传 null 恢复浏览器存储。 */
export function __setStorageForTests(next: StorageLike | null): void {
  override = next
}

export function readStorage(key: string): string | null {
  try {
    return backend().getItem(key)
  } catch {
    return null
  }
}

export function writeStorage(key: string, value: string): boolean {
  try {
    backend().setItem(key, value)
    return true
  } catch {
    return false // 配额满/被禁用：调用方决定是否降级
  }
}

export function removeStorage(key: string): void {
  try {
    backend().removeItem(key)
  } catch {
    /* 忽略 */
  }
}
