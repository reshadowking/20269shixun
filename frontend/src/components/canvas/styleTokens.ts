/**
 * T5 批A：画布与导出共用的组件级令牌常量（交付缺口清单 §4.5 残项 #3/#6/#7/#8/#9 收敛）。
 * 每个色值只有一处定义（经 resolveColor 取 design-system.yaml），画布/导出两侧共用；
 * 独立成模块而非写在组件文件内，避免新增 react(only-export-components) 告警（任务卡陷阱 6 的批 C 方式）。
 * 护栏测试：同目录 styleTokens.test.ts（常量值 == 令牌解析值，改 hex 脱钩立刻红）。
 */
import { resolveColor } from '@/design/styleToCss'
import { EFFECT_SPECS } from '@/design/beautify'

/**
 * 变体底色（T5-0 #5 修复，批C 移入本模块）：画布与导出共用同一映射——底色/描边取
 * design-system.yaml 令牌，填充上的文字统一白（shadcn 主题三处 --*-foreground 均为
 * #ffffff，令牌表无对应项，收敛为常量）。此前导出 builder 只输出 node.style，
 * 变体底色整体丢失，导出工程里"按钮没颜色"。
 */
export const BUTTON_VARIANT_STYLE: Record<string, React.CSSProperties> = {
  default: { background: resolveColor('primary'), color: '#FFFFFF' },
  primary: { background: resolveColor('primary'), color: '#FFFFFF' },
  secondary: { background: resolveColor('secondary'), color: '#FFFFFF' },
  outline: { background: '#FFFFFF', border: `1px solid ${resolveColor('border')}` },
  ghost: {},
  destructive: { background: resolveColor('danger'), color: '#FFFFFF' },
}

/**
 * 图表序列色（T5-0 #2 修复，批C 移入本模块）：画布与导出共用。前四色取
 * design-system.yaml 令牌（primary/secondary/success/danger，与原画布硬编码值逐一
 * 相等），第五色令牌表无语义对应、保留原值。此前导出柱色硬编码 #3D7FFF（恰为
 * dark 主题 primary，与画布 #0052D9 不一致），pie 多系列色在导出侧整体丢失。
 */
export const CHART_COLORS: string[] = [
  resolveColor('primary')!,
  resolveColor('secondary')!,
  resolveColor('success')!,
  resolveColor('danger')!,
  '#FF6B6B',
]

/** 令牌 hex → rgba()（表头底色等需要透明度的派生值用） */
function tokenRgba(token: string, alpha: number): string {
  const hex = resolveColor(token)!
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`
}

/** §4.5 #3 图表轴文字：画布 tick fill / 导出轴标签 = text-light */
export const CHART_AXIS_COLOR = resolveColor('text-light')!

/** §4.5 #3 图表网格线：画布 CartesianGrid stroke = border（导出为 CSS 柱近似，无网格） */
export const CHART_GRID_COLOR = resolveColor('border')!

/** §4.5 #6 输入框标签：口径定为「以画布为准」——画布是所见即所得的一侧，
 * 原为主题近黑（--foreground ≈ text-primary），故导出从 text-secondary 上调为 text-primary。 */
export const INPUT_LABEL_COLOR = resolveColor('text-primary')!

/** §4.5 #7 指标块 label：两侧统一 text-light（值与原硬编码相等，来源收敛） */
export const STAT_LABEL_COLOR = resolveColor('text-light')!

/** §4.5 #8 导航链接：两侧统一 text-light（导出此前无 color 继承黑） */
export const NAV_LINK_COLOR = resolveColor('text-light')!

/** §4.5 #9 表格单元格边框：两侧统一 border 令牌（值与原硬编码相等，来源收敛） */
export const TABLE_CELL_BORDER = `1px solid ${resolveColor('border')!}`

/** §4.5 #9 表头底色：画布原为 shadcn --muted(#f5f5f5)/50，与 background 令牌同值，派生 50% 透明 */
export const TABLE_HEAD_BACKGROUND = tokenRgba('background', 0.5)

/** §4.5 #9 表头文字：画布原 text-muted-foreground(#86909c) = text-light，导出此前缺色继承黑 */
export const TABLE_HEAD_TEXT_COLOR = resolveColor('text-light')!

/** 控件禁用态（T5 批B §4.2.5 决策 a）：button/input 共用，内联保证 jsdom 可测、导出可同步 */
export const DISABLED_STYLE: React.CSSProperties = { opacity: 0.5, cursor: 'not-allowed' }

/** 控件默认观感（T5 批B）：input/select 共用——h-10 px-3 py-2 text-sm rounded-md
 * border-input bg-background 的内联等价（shadcn --background 白与 button 白字同口径）。 */
export const CONTROL_DEFAULT_STYLE: React.CSSProperties = {
  height: 40,
  padding: '8px 12px',
  border: `1px solid ${resolveColor('border')!}`,
  borderRadius: 8,
  background: '#FFFFFF',
  fontSize: 14,
}

/** 卡片阴影：取 beautify-effects 预置「极轻」（令牌化阴影预置，非新造 hex） */
export const CARD_SHADOW = EFFECT_SPECS.find((s) => s.key === 'shadow')!.values[0].value as string

/** 卡片默认观感（T5 批B）：rounded-lg border shadow-sm p-6 的内联等价，画布/导出共用 */
export const CARD_DEFAULT_STYLE: React.CSSProperties = {
  padding: 24,
  border: `1px solid ${resolveColor('border')!}`,
  borderRadius: 8,
  boxShadow: CARD_SHADOW,
}
