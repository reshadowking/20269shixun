/**
 * T5 批A：画布与导出共用的组件级令牌常量（交付缺口清单 §4.5 残项 #3/#6/#7/#8/#9 收敛）。
 * 每个色值只有一处定义（经 resolveColor 取 design-system.yaml），画布/导出两侧共用；
 * 独立成模块而非写在组件文件内，避免新增 react(only-export-components) 告警（任务卡陷阱 6 的批 C 方式）。
 * 护栏测试：同目录 styleTokens.test.ts（常量值 == 令牌解析值，改 hex 脱钩立刻红）。
 */
import { resolveColor } from '@/design/styleToCss'

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
