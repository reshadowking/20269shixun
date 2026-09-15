/**
 * localStorage JSON 读写（缺陷 1/3 共用）：
 * 损坏数据、配额失败、localStorage 被禁用都安全降级（读返回 null、写返回 false），绝不抛错。
 */

export function scopedKey(base: string, scope?: string): string {
  return scope ? `${base}-${scope}` : base
}

export function loadJson<T>(key: string, validate: (v: unknown) => v is T): T | null {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw) as unknown
    return validate(parsed) ? parsed : null
  } catch {
    return null
  }
}

/** 写入成功返回 true；配额不足/被禁用返回 false（调用方自行降级） */
export function saveJson(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value))
    return true
  } catch {
    return false
  }
}

export function removeJson(key: string): void {
  try {
    localStorage.removeItem(key)
  } catch {
    /* 忽略：localStorage 不可用时本就没有数据 */
  }
}
