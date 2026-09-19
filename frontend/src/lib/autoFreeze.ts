/**
 * 「AI 生成后自动转自由画布」偏好（2026-09-17）。
 *
 * 需求原话："我需要 ai 生成的默认就是可以编辑的……不要多余一步去转自由画布"。
 * 模板骨架全是 flex（拖动只能重排顺序），所以生成后需要一次冻结（DOM 测量 → 写 x/y/宽高）
 * 才能任意摆放。默认开；若某些稿子冻结后观感不对，可在「设置」里一键关掉、退回 flex。
 *
 * 与 T45 视图记忆同一套写法：白名单 + 存储适配器（测试注入内存实现）。
 */
import { readStorage, writeStorage } from '@/lib/storage'

export const AUTO_FREEZE_KEY = 'canvas-auto-freeze'

/** 默认开：这正是用户要的"生成即可编辑" */
export function readAutoFreeze(): boolean {
  return readStorage(AUTO_FREEZE_KEY) !== '0'
}

export function writeAutoFreeze(on: boolean): void {
  writeStorage(AUTO_FREEZE_KEY, on ? '1' : '0')
}

/**
 * 自动冻结的前置守卫（纯函数，便于单测）。
 *
 * 必须与「🔓 转自由画布」按钮同一套条件——**版面已确认（锁定）**和**只读访客**下，
 * `store.convertToFreeLayout()` 一定会拒绝；此时若还先 `pushSnapshot()`，就会留下
 * 一个「没有真实改动的撤销步」：撤销按钮亮着、按了却什么都不发生（撤销计数只增不减）。
 * 已经是 free 的画布也直接跳过（幂等，不重复冻结）。
 */
export function canAutoFreeze(state: { locked: boolean; readOnly: boolean; layout?: string }): boolean {
  return !state.locked && !state.readOnly && state.layout !== 'free'
}
