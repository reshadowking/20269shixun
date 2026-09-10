/**
 * 美化效果白名单（缺陷 3）：与 shared/beautify-effects.json 单一来源（契约测试保证一致）。
 * 用途：① 美化面板的预设按钮；② DesignStore 锁定期的写入层校验；③ 尺寸变更提示判定。
 */
export interface EffectPreset {
  value: string | number
  label: string
}

export interface EffectSpec {
  key: string
  label: string
  /** 该效果可能改变组件尺寸（应用前需二次确认） */
  changesSize: boolean
  values: EffectPreset[]
}

export const EFFECT_SPECS: EffectSpec[] = [
  {
    key: 'backgroundImage',
    label: '背景渐变',
    changesSize: false,
    values: [
      { value: 'linear-gradient(135deg, #0052D9 0%, #7C4DFF 100%)', label: '品牌渐变' },
      { value: 'linear-gradient(135deg, #FF6B6B 0%, #FF8E53 100%)', label: '暖色渐变' },
      { value: 'linear-gradient(160deg, #14161A 0%, #2A2E36 100%)', label: '深色渐变' },
      { value: 'radial-gradient(circle at 30% 20%, #E8F0FF 0%, #F5F5F5 70%)', label: '柔和光晕' },
    ],
  },
  {
    key: 'shadow',
    label: '投影阴影',
    changesSize: false,
    values: [
      { value: '0 1px 2px rgba(29,33,41,0.06)', label: '极轻' },
      { value: '0 4px 12px rgba(29,33,41,0.10)', label: '轻' },
      { value: '0 10px 30px rgba(29,33,41,0.16)', label: '中' },
      { value: '0 18px 48px rgba(0,82,217,0.24)', label: '强调' },
    ],
  },
  {
    key: 'animation',
    label: '入场动效',
    changesSize: false,
    values: [
      { value: 'fade-in', label: '淡入' },
      { value: 'rise-in', label: '上浮' },
      { value: 'pulse-soft', label: '轻脉冲' },
    ],
  },
  {
    key: 'radius',
    label: '圆角',
    changesSize: false,
    values: [
      { value: 8, label: '小圆角' },
      { value: 16, label: '大圆角' },
      { value: 24, label: '胶囊圆角' },
    ],
  },
  {
    key: 'border',
    label: '描边',
    changesSize: true,
    values: [
      { value: '1px solid #E5E8EF', label: '细描边' },
      { value: '2px solid #0052D9', label: '强调描边' },
    ],
  },
  {
    key: 'transform',
    label: '强调变换',
    changesSize: true,
    values: [
      { value: 'scale(1.04)', label: '放大 4%' },
      { value: 'translateY(-4px)', label: '上移 4px' },
    ],
  },
]

export const EFFECT_KEYS: string[] = EFFECT_SPECS.map((s) => s.key)

/** 可能改变组件尺寸的效果键（应用前提示「该效果可能改变组件尺寸，是否确认应用」） */
export const SIZE_CHANGING_KEYS: string[] = EFFECT_SPECS.filter((s) => s.changesSize).map((s) => s.key)

/**
 * 版面确认（锁定）后仍允许写入的样式键：效果白名单 + 颜色/背景。
 * 布局（layout/gap/padding/width/height）、文本（props）、结构（children/type/id）与位置（x/y）不在其中。
 */
export const LOCKED_EDITABLE_STYLE_KEYS: string[] = [...EFFECT_KEYS, 'color', 'background']

const PRESET_VALUES: Record<string, Set<string | number>> = Object.fromEntries(
  EFFECT_SPECS.map((s) => [s.key, new Set(s.values.map((v) => v.value))]),
)

/** 效果预设是否合法（key 在白名单内且取值命中预置集合） */
export function isWhitelistedEffect(key: string, value: unknown): boolean {
  if (!EFFECT_KEYS.includes(key)) return false
  if (value === null) return true // null = 移除效果
  return PRESET_VALUES[key].has(value as string | number)
}

/** 校验一组效果；返回违规键（空数组 = 全部合法）。与后端 422 判定同源 */
export function findInvalidEffectKeys(effects: Record<string, unknown>): string[] {
  return Object.entries(effects)
    .filter(([key, value]) => !isWhitelistedEffect(key, value))
    .map(([key]) => key)
}

/** 预设展示名（找不到则回退为原值） */
export function effectValueLabel(key: string, value: unknown): string {
  const spec = EFFECT_SPECS.find((s) => s.key === key)
  const hit = spec?.values.find((v) => v.value === value)
  return hit?.label ?? String(value)
}

/** 节点上已应用的高级效果（用于对比视图与"关闭全部效果"提示） */
export function collectAppliedEffects(node: { style?: Record<string, unknown> }): Array<{ key: string; value: unknown }> {
  const style = node.style ?? {}
  return EFFECT_KEYS.filter((k) => style[k] !== undefined).map((k) => ({ key: k, value: style[k] }))
}

/** 设计树中带高级效果的节点数（对比视图显示"改了多少处"） */
export function countBeautifiedNodes(tree: { style?: Record<string, unknown>; children?: unknown[] }): number {
  let count = collectAppliedEffects(tree).length > 0 ? 1 : 0
  for (const child of (tree.children ?? []) as Array<{ style?: Record<string, unknown>; children?: unknown[] }>) {
    count += countBeautifiedNodes(child)
  }
  return count
}
