/**
 * T5 批A：画布与导出共用的组件级令牌常量（交付缺口清单 §4.5 残项 #3/#6/#7/#8/#9 收敛）。
 * 每个色值只有一处定义（经 resolveColor 取 design-system.yaml），画布/导出两侧共用；
 * 独立成模块而非写在组件文件内，避免新增 react(only-export-components) 告警（任务卡陷阱 6 的批 C 方式）。
 * 护栏测试：同目录 styleTokens.test.ts（常量值 == 令牌解析值，改 hex 脱钩立刻红）。
 */
import { resolveColor } from '@/design/styleToCss'
import { EFFECT_SPECS } from '@/design/beautify'

/** 卡片阴影：取 beautify-effects 预置「极轻」（令牌化阴影预置，非新造 hex） */
export const CARD_SHADOW = EFFECT_SPECS.find((s) => s.key === 'shadow')!.values[0].value as string

/**
 * 变体底色（T5-0 #5 修复，批C 移入本模块）：画布与导出共用同一映射——底色/描边取
 * design-system.yaml 令牌，填充上的文字统一白（shadcn 主题三处 --*-foreground 均为
 * #ffffff，令牌表无对应项，收敛为常量）。此前导出 builder 只输出 node.style，
 * 变体底色整体丢失，导出工程里"按钮没颜色"。
 */
export const BUTTON_VARIANT_STYLE: Record<string, React.CSSProperties> = {
  // 阴影跟变体走（T5.6 #14）：修复前 ghost 没有 shadow-sm，其余变体有——
  // BUTTON_BASE_STYLE 不得无条件施加 boxShadow
  default: { background: resolveColor('primary'), color: '#FFFFFF', boxShadow: CARD_SHADOW },
  primary: { background: resolveColor('primary'), color: '#FFFFFF', boxShadow: CARD_SHADOW },
  secondary: { background: resolveColor('secondary'), color: '#FFFFFF', boxShadow: CARD_SHADOW },
  outline: { background: '#FFFFFF', border: `1px solid ${resolveColor('border')}`, boxShadow: CARD_SHADOW },
  ghost: {},
  destructive: { background: resolveColor('danger'), color: '#FFFFFF', boxShadow: CARD_SHADOW },
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

/** 控件默认观感（T5 批B；T5.5 圆角口径 a 后与画布类逐项等价）：input/select 共用——
 * h-10 px-3 py-2 text-sm rounded-md border-input bg-background 的内联等价
 * （rounded-md = --radius-md = calc(0.5rem - 2px) = 6px，画布现状优先；shadcn
 * --background 白与 button 白字同口径）。 */
export const CONTROL_DEFAULT_STYLE: React.CSSProperties = {
  height: 40,
  padding: '8px 12px',
  border: `1px solid ${resolveColor('border')!}`,
  borderRadius: 6,
  background: '#FFFFFF',
  fontSize: 14,
}

/** 卡片默认观感（T5 批B；T5.5 并入底色/文字色）：rounded-lg border shadow-sm p-6
 * bg-card text-card-foreground 的内联等价（shadcn --card 白、--card-foreground 主文本，
 * 与令牌 text-primary 同值），画布/导出共用。 */
export const CARD_DEFAULT_STYLE: React.CSSProperties = {
  padding: 24,
  border: `1px solid ${resolveColor('border')!}`,
  borderRadius: 8,
  boxShadow: CARD_SHADOW,
  background: '#FFFFFF',
  color: resolveColor('text-primary')!,
}

/** 按钮静态基础观感（T5.5 #12）：rounded-md text-sm font-medium 的内联等价
 * （圆角口径 a = 6px）。阴影跟变体走（见 BUTTON_VARIANT_STYLE，ghost 无阴影）；
 * 尺寸相关的 height/padding 由画布与 buildButtonExport 按 size 计算；
 * 交互态（hover/active/focus）走类，导出不实现。 */
export const BUTTON_BASE_STYLE: React.CSSProperties = {
  borderRadius: 6,
  fontSize: 14,
  fontWeight: 500,
}

// ---- T12-A：导航类组件配方（口径以画布为准；此前默认观感在 Tailwind 类名里、导出侧整体丢失）----

/** 导航默认观感（h-14 / px-6 / border-b / bg-background）：高度 56、左右内边距 24、
 * 下边框 border 令牌、底色白（bg-background = --background #ffffff；白为既有例外口径，
 * 与 CARD_DEFAULT_STYLE 一致）。画布与导出共用，node.style 最后展开。 */
export const NAVBAR_DEFAULT_STYLE: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  height: 56,
  paddingLeft: 24,
  paddingRight: 24,
  borderBottom: `1px solid ${resolveColor('border')!}`,
  background: '#FFFFFF',
}

/** 导航标题（text-lg font-semibold = 18 / 600）——此前导出 <strong> 为浏览器默认 16/700 */
export const NAVBAR_TITLE_STYLE: React.CSSProperties = { fontSize: 18, fontWeight: 600 }

/** 导航链接容器（gap-6 = 24）——T12-A 统一到画布口径；此前导出用 marginLeft 12（不一致） */
export const NAVBAR_LINKS_STYLE: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 24 }

/** 导航链接文字（text-sm = 14）；颜色另由 NAV_LINK_COLOR（text-light 令牌） */
export const NAVBAR_LINK_STYLE: React.CSSProperties = { fontSize: 14, color: NAV_LINK_COLOR }

/** 侧栏默认观感（w-48 / p-4 / gap-1）：宽度 192、内边距 16、项间距 4、纵向排列。
 * 底色 ASIDE_BG 由 sidebar 组件定义（T5-0 基准，不重写）。 */
export const SIDEBAR_DEFAULT_STYLE: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  width: 192,
  padding: 16,
  gap: 4,
}

/** 侧栏项基础观感（px-3 py-2 / rounded-md / text-sm = 内边距 12/8、圆角 6、字号 14）——
 * active/idle 的颜色叠加仍由 sidebar 组件的 T5-0 常量负责。 */
export const SIDEBAR_ITEM_BASE: React.CSSProperties = { padding: '8px 12px', borderRadius: 6, fontSize: 14 }
