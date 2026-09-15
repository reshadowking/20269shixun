/**
 * 导出图片内联（ADR-008 / 缺口 P0-1 / 任务 T-P0-1）。
 *
 * 背景：上传图片的 `props.src` 是平台内部接口路径 `/api/images/{id}`，
 * 导出工程脱离平台后必然 404。本模块在导出前把这些图片读成 dataURL，
 * 由导出引擎替换 `src`，使产物自包含（`preview.html` 离线也能看图）。
 *
 * 设计约定：
 * - 只收集**平台内部路径**（`/api/images/`），外部 http(s) URL 原样保留（对方自带托管）；
 * - 读取失败（图片已删 / 网络异常）**跳过该图并记录**，不抛错、不产出半成品；
 * - 协议白名单已放行 `data:image/`（见 `frontend/src/design/escape.ts`），无需改安全策略。
 */
import type { DesignNode } from '@/design/types'

/** 原始 src → dataURL 的映射 */
export type AssetMap = Record<string, string>

/** 只内联平台内部上传路径；外链由对方托管，保持原样 */
export const INTERNAL_SRC_PREFIX = '/api/images/'

/** 递归收集设计树中需要内联的图片 src（去重，保持首次出现顺序） */
export function collectImageSrcs(design: DesignNode): string[] {
  const found: string[] = []
  const seen = new Set<string>()

  const walk = (node: DesignNode): void => {
    const src = node.props?.src
    if (typeof src === 'string' && src.startsWith(INTERNAL_SRC_PREFIX) && !seen.has(src)) {
      seen.add(src)
      found.push(src)
    }
    for (const child of node.children ?? []) walk(child)
  }

  walk(design)
  return found
}

/** 单个 src → dataURL；失败返回 null */
export async function fetchAsDataUrl(src: string): Promise<string | null> {
  try {
    const resp = await fetch(src)
    if (!resp.ok) return null
    const blob = await resp.blob()
    return await blobToDataUrl(blob)
  } catch {
    return null
  }
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('FileReader 读取失败'))
    reader.readAsDataURL(blob)
  })
}

export interface InlineAssetsResult {
  assets: AssetMap
  /** 读取失败、未能内联的 src（调用方应提示，不得静默产出破图） */
  failed: string[]
}

/**
 * 批量读取并转为 dataURL。
 * 注意：**不抛错**——单个失败不影响其余；失败项由调用方决定如何提示。
 */
export async function loadInlineAssets(srcs: string[]): Promise<InlineAssetsResult> {
  const assets: AssetMap = {}
  const failed: string[] = []

  for (const src of srcs) {
    const dataUrl = await fetchAsDataUrl(src)
    if (dataUrl) assets[src] = dataUrl
    else failed.push(src)
  }

  return { assets, failed }
}
