/**
 * 设计节点 style 的**可渲染键 + 别名**（T49 / C2）。
 *
 * **直接 import** `shared/style-keys.json`（相对路径 JSON import，与
 * `components/canvas/icon/index.tsx` 引入 `shared/icon-library.json` 同一手法）——
 * 不手抄镜像，于是不存在"镜像与事实源漂移"这一类问题。
 *
 * 用途：
 * ① `styleToCss` 按别名归一，让模型写的近义键（boxShadow/borderRadius/backgroundColor）
 *    真正渲染出来；
 * ② 变更清单用它判定"这个字段渲染层支不支持"，从而在回执里**如实说明**而不是冒充成功。
 */
import spec from '../../../shared/style-keys.json'

export interface StyleKeysSpec {
  renderable: string[]
  aliases: Record<string, string>
  labels: Record<string, string>
}

export const STYLE_KEYS: StyleKeysSpec = {
  renderable: spec.renderable,
  aliases: spec.aliases,
  labels: spec.labels,
}

const RENDERABLE = new Set(STYLE_KEYS.renderable)

/** 该 style 键是否会被渲染层消费（不在清单里的键渲染不出来） */
export function isRenderableStyleKey(key: string): boolean {
  return RENDERABLE.has(STYLE_KEYS.aliases[key] ?? key)
}

/** 别名 → 规范键（无别名时原样返回） */
export function normalizeStyleKey(key: string): string {
  return STYLE_KEYS.aliases[key] ?? key
}

/** 字段的中文名（变更清单里显示；未登记的键回落到键名本身） */
export function styleKeyLabel(key: string): string {
  const canonical = normalizeStyleKey(key)
  return STYLE_KEYS.labels[canonical] ?? canonical
}

/**
 * 按别名归一整份 style（**规范键优先**：已有规范键时忽略别名，避免"谁赢"不确定）。
 * `styleToCss` 与变更清单共用它，保证"判定能渲染"与"真的渲染"是同一套规则。
 */
export function normalizeStyleKeys(style: Record<string, unknown> | undefined): Record<string, unknown> {
  const raw = style ?? {}
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(raw)) {
    if (value === undefined) continue
    const target = STYLE_KEYS.aliases[key] ?? key
    if (target !== key && raw[target] !== undefined) continue
    out[target] = value
  }
  return out
}
