/**
 * T45：资产库展示方式（类似文件管理器的"查看"菜单）。
 *
 * 四种：小图标 / 大图标 / 平铺 / 文件信息（详细列表）。
 * 选择要**记住**（下次进来还是上次那种），存 localStorage；读不到或值非法时回落到大图标。
 * 纯函数 + 统一存储适配器，便于单测（不直接摸 window.localStorage）。
 */
import { readStorage, writeStorage } from '@/lib/storage'

export const ASSET_VIEW_KEY = 'asset-view'

export const ASSET_VIEWS = ['small', 'large', 'tiles', 'details'] as const
export type AssetView = (typeof ASSET_VIEWS)[number]

export const ASSET_VIEW_LABEL: Record<AssetView, string> = {
  small: '小图标',
  large: '大图标',
  tiles: '平铺',
  details: '文件信息',
}

export const DEFAULT_ASSET_VIEW: AssetView = 'large'

export function isAssetView(value: unknown): value is AssetView {
  return typeof value === 'string' && (ASSET_VIEWS as readonly string[]).includes(value)
}

/** 读取记忆的展示方式；非法值/首次访问 → 默认"大图标"。 */
export function readAssetView(): AssetView {
  const raw = readStorage(ASSET_VIEW_KEY)
  return isAssetView(raw) ? raw : DEFAULT_ASSET_VIEW
}

/** 记住展示方式（写不进去也不影响本次使用）。 */
export function writeAssetView(view: AssetView): void {
  writeStorage(ASSET_VIEW_KEY, view)
}
