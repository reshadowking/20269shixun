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
