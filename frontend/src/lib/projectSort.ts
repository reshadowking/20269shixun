/**
 * 「我的项目」排序方式的记忆（2026-09-16）。
 *
 * 与 T45 的资产展示方式同一套写法：白名单 + 存储适配器（测试注入内存实现，不碰 window.localStorage）。
 * 为什么值得记：排序是"用户偏好"，刷新一次就回到默认会让人以为排序是前端假的。
 */
import { readStorage, writeStorage } from '@/lib/storage'

export const PROJECT_SORT_KEY = 'projects-sort'

export const PROJECT_SORTS = ['updated_desc', 'updated_asc', 'name_asc', 'created_desc'] as const
export type ProjectSort = (typeof PROJECT_SORTS)[number]

export const DEFAULT_PROJECT_SORT: ProjectSort = 'updated_desc'

export function isProjectSort(value: unknown): value is ProjectSort {
  return typeof value === 'string' && (PROJECT_SORTS as readonly string[]).includes(value)
}

/** 读取记忆的排序；没存过/值非法（手改过 localStorage）→ 回落"最近修改"。 */
export function readProjectSort(): ProjectSort {
  const raw = readStorage(PROJECT_SORT_KEY)
  return isProjectSort(raw) ? raw : DEFAULT_PROJECT_SORT
}

/** 记住排序方式（写不进去也不影响本次使用）。 */
export function writeProjectSort(sort: ProjectSort): void {
  writeStorage(PROJECT_SORT_KEY, sort)
}
