/**
 * 右侧面板宽度：夹紧与持久化（T49）。
 *
 * 为什么把夹紧写成纯函数：窄屏下"上界"会小于"下界"，直接 `clamp(w, min, max)`
 * 会得到反区间（min > max 时结果不可预期）。这里先把上界与下界取大，
 * 保证 **任何视口宽度下区间都非空**。
 *
 * 持久化走 `lib/storage.ts` 适配器（不直接摸 localStorage），沿用 `design-*` 前缀。
 */
import { readStorage, writeStorage } from './storage'

export const PANEL_WIDTH_KEY = 'design-activity-panel-width'
export const PANEL_WIDTH_DEFAULT = 320
export const PANEL_WIDTH_MIN = 260
export const PANEL_WIDTH_MAX = 720
/** 面板最宽不超过视口的这个比例，保证画布不被压没 */
export const PANEL_WIDTH_VIEWPORT_RATIO = 0.6
/** 键盘微调步长（无障碍：分隔条可聚焦后用方向键调整） */
export const PANEL_WIDTH_STEP = 24

/**
 * 夹紧面板宽度。
 *
 * `upper = max(min, min(max, viewportWidth * ratio))` —— 先与下界取大，
 * 所以窄屏（如 400px 视口：0.6*400 = 240 < 260）下上界退化为 260，区间仍有效。
 */
export function clampPanelWidth(width: number, viewportWidth: number): number {
  const viewport = Number.isFinite(viewportWidth) && viewportWidth > 0 ? viewportWidth : 1280
  const upper = Math.max(
    PANEL_WIDTH_MIN,
    Math.min(PANEL_WIDTH_MAX, viewport * PANEL_WIDTH_VIEWPORT_RATIO),
  )
  if (!Number.isFinite(width)) return PANEL_WIDTH_DEFAULT
  return Math.max(PANEL_WIDTH_MIN, Math.min(upper, Math.round(width)))
}

/** 读持久化宽度（缺省/脏值/越界都回落到合法值，绝不返回 NaN 或反区间） */
export function readPanelWidth(viewportWidth: number): number {
  const raw = readStorage(PANEL_WIDTH_KEY)
  const parsed = raw === null || raw.trim() === '' ? Number.NaN : Number(raw)
  return clampPanelWidth(Number.isFinite(parsed) ? parsed : PANEL_WIDTH_DEFAULT, viewportWidth)
}

/** 写持久化宽度（只在拖拽结束/复位时调用，不在 pointermove 里写） */
export function writePanelWidth(width: number): void {
  writeStorage(PANEL_WIDTH_KEY, String(Math.round(width)))
}
