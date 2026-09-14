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

// ---- T12-B：展示类组件配方（口径以画布为准）----

/** Hero 默认观感（px-12 py-20 / gap-4 / bg-muted / 居中）：内边距 80×48、间距 16、
 * 底色 background 令牌（bg-muted = --muted = 令牌 background #F5F5F5）、内容居中 */
export const HERO_DEFAULT_STYLE: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 16,
  padding: '80px 48px',
  textAlign: 'center',
  background: resolveColor('background'),
}

/** Hero 标题（text-4xl font-bold = 36 / 700） */
export const HERO_TITLE_STYLE: React.CSSProperties = { fontSize: 36, fontWeight: 700 }

/** Hero 副标题（text-lg = 18；色 = text-light 令牌，与画布 muted-foreground 同源） */
export const HERO_SUBTITLE_STYLE: React.CSSProperties = { fontSize: 18, color: resolveColor('text-light') }

/** Hero CTA：复用按钮配方（BUTTON_BASE_STYLE + primary 变体），尺寸 px-6 py-2.5 = 24×10、上间距 8 */
export const HERO_CTA_STYLE: React.CSSProperties = {
  ...BUTTON_BASE_STYLE,
  ...BUTTON_VARIANT_STYLE.primary,
  padding: '10px 24px',
  marginTop: 8,
}

/** 图片默认观感（w-full rounded-md）：宽 100%、圆角 6、块级（消除行内基线间隙） */
export const IMAGE_DEFAULT_STYLE: React.CSSProperties = { display: 'block', width: '100%', borderRadius: 6 }

/** 图片空态占位盒（h-40 + 虚线边框 + bg-muted/30）：高度 160、圆角 6、1px 虚线 border 令牌、
 * background 令牌 30% 透明（进度对齐画布 border border-dashed bg-muted/30） */
export const IMAGE_PLACEHOLDER_STYLE: React.CSSProperties = {
  height: 160,
  borderRadius: 6,
  border: `1px dashed ${resolveColor('border')!}`,
  background: tokenRgba('background', 0.3),
}

/** 画布空态占位的居中与提示文字（导出侧为 <img>，无法承载子文本——只复用上面的盒子样式） */
export const IMAGE_PLACEHOLDER_CANVAS_STYLE: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: 12,
  color: resolveColor('text-light'),
}

// ---- T12-C：数据类组件配方（口径以画布为准）----

/** 表格/图表容器观感（rounded-lg border bg-card）：圆角 8 / border 令牌 / 白底。
 * 表格结构差异说明：画布是「外层 div + table」，导出为单个 <table> 承载同款容器观感
 * （单元格不再各带边框，行分隔线走行容器——与画布 tr border-b 语义一致）。 */
export const TABLE_CONTAINER_STYLE: React.CSSProperties = {
  width: '100%',
  borderRadius: 8,
  border: TABLE_CELL_BORDER,
  background: '#FFFFFF',
}

/** 表格单元格默认观感（px-4 py-3 = 内边距 16×12）——此前导出为 8，与画布不一致 */
export const TABLE_CELL_STYLE: React.CSSProperties = { padding: '12px 16px' }

/** 表头单元格（text-left font-medium = 左对齐 + 500；色另由 TABLE_HEAD_TEXT_COLOR） */
export const TABLE_HEAD_CELL_STYLE: React.CSSProperties = { textAlign: 'left', fontWeight: 500 }

/** 表格行分隔线（画布 tr border-b，末行无） */
export const TABLE_ROW_BORDER: React.CSSProperties = { borderBottom: TABLE_CELL_BORDER }

/** 图表容器（与 TABLE_CONTAINER_STYLE 同观感 + p-4 = padding 16） */
export const CHART_DEFAULT_STYLE: React.CSSProperties = {
  ...TABLE_CONTAINER_STYLE,
  padding: 16,
}

/** 图表标题（text-sm font-semibold mb-4 = 14 / 600 / 下间距 16；此前导出下间距 12） */
export const CHART_TITLE_STYLE: React.CSSProperties = { fontSize: 14, fontWeight: 600, marginBottom: 16 }

// ---- T12-D：内容/装饰型组件配方（口径以画布为准）----

/** 标签基础观感（rounded-md px-2.5 py-0.5 text-xs font-semibold = 圆角 6 / 内边距 2×10 / 字号 12 / 字重 600） */
export const TAG_BASE_STYLE: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  borderRadius: 6,
  padding: '2px 10px',
  fontSize: 12,
  fontWeight: 600,
}

/** 标签默认分支（bg-secondary text-secondary-foreground）：次级色底 + 白字
 *（--secondary-foreground = #ffffff） */
export const TAG_DEFAULT_COLOR_STYLE: React.CSSProperties = {
  background: resolveColor('secondary'),
  color: '#FFFFFF',
}

/** 指标块容器（rounded-lg border bg-card p-4 shadow-sm）：圆角 8 / border 令牌 / 白底 /
 * padding 16 / 「极轻」阴影（CARD_SHADOW）。label/value/trend 三块沿用既有令牌常量，不动。 */
export const STAT_CONTAINER_STYLE: React.CSSProperties = {
  borderRadius: 8,
  border: `1px solid ${resolveColor('border')!}`,
  background: '#FFFFFF',
  padding: 16,
  boxShadow: CARD_SHADOW,
}

/** 分割线（h-px w-full bg-border）：高 1px / 无边框 / border 令牌底色 / 外边距清零
 * （导出为 <hr>，必须清掉浏览器默认边框与 margin，画布与导出的间距才一致） */
export const DIVIDER_STYLE: React.CSSProperties = {
  height: 1,
  border: 'none',
  background: resolveColor('border'),
  margin: 0,
  width: '100%',
}

/** 标题文本字重/行高/外边距（font-semibold leading-tight）：600 / 1.25 / margin 0
 * （导出为 <h*>，默认 700 与上下 margin 会与画布不一致，必须清零） */
export const TITLE_TEXT_WEIGHT_STYLE: React.CSSProperties = { fontWeight: 600, lineHeight: 1.25, margin: 0 }

/** 标题文本按等级字号（画布既有口径：h1-h6 = 28/24/20/18/16/14） */
export const TITLE_TEXT_SIZES: Record<number, number> = { 1: 28, 2: 24, 3: 20, 4: 18, 5: 16, 6: 14 }

/** 头像默认观感（h-10 w-10 rounded-full bg-primary text-sm font-semibold text-primary-foreground）：
 * 40×40 / 圆形 / primary 底 / 白字 14px / 600。圆形与居中此前导出已有——并入本常量统一为
 * 一处定义（值不变），并修正展开顺序为「默认在前、node.style 最后」。 */
export const AVATAR_DEFAULT_STYLE: React.CSSProperties = {
  width: 40,
  height: 40,
  borderRadius: '50%',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: resolveColor('primary'),
  color: '#FFFFFF',
  fontSize: 14,
  fontWeight: 600,
}

// ---- T13 #26：指标块三块内容配方（口径以画布为准，纠正 T12 卡"别动"遗漏）----

/** 指标块 label（text-sm = 14；此前导出 13） */
export const STAT_LABEL_STYLE: React.CSSProperties = { fontSize: 14, color: STAT_LABEL_COLOR }

/** 指标块 value（text-2xl font-bold + mt-1 = 24 / 700 / 上间距 4；此前导出缺上间距） */
export const STAT_VALUE_STYLE: React.CSSProperties = { fontSize: 24, fontWeight: 700, marginTop: 4 }

/** 指标块 trend（text-xs + mt-1 = 12 / 上间距 4；色由 trendColor 叠加） */
export const STAT_TREND_STYLE: React.CSSProperties = { fontSize: 12, marginTop: 4 }
