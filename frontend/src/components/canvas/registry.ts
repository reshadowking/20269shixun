/**
 * 组件注册表（v2.2 §5.2/5.3）：画布渲染 / 导出引擎 / 组件面板 / 属性面板统一从这里读取。
 * 新增组件 = 一个文件夹（四份定义）+ 这里登记一行 + 测试。
 */
import { Frame, Square, Type, type LucideIcon } from 'lucide-react'

import { CanvasAvatar, buildAvatarExport, avatarSchema } from '@/components/canvas/avatar'
import { CanvasButton, buildButtonExport, buttonSchema } from '@/components/canvas/button'
import { CanvasCard, buildCardExport, cardSchema } from '@/components/canvas/card'
import { CanvasChart, buildChartExport, chartSchema } from '@/components/canvas/chart'
import { CanvasDivider, buildDividerExport, dividerSchema } from '@/components/canvas/divider'
import { CanvasHero, buildHeroExport, heroSchema } from '@/components/canvas/hero'
import { CanvasIcon, buildIconExport, iconSchema } from '@/components/canvas/icon'
import { CanvasImage, buildImageExport, imageSchema } from '@/components/canvas/image'
import { CanvasInput, buildInputExport, inputSchema } from '@/components/canvas/input'
import { CanvasNavbar, buildNavbarExport, navbarSchema } from '@/components/canvas/navbar'
import { CanvasSelect, buildSelectExport, selectSchema } from '@/components/canvas/select'
import { CanvasSidebar, buildSidebarExport, sidebarSchema } from '@/components/canvas/sidebar'
import { CanvasStatBlock, buildStatBlockExport, statBlockSchema } from '@/components/canvas/stat-block'
import { CanvasSwitch, buildSwitchExport, switchSchema } from '@/components/canvas/switch'
import { CanvasTable, buildTableExport, tableSchema } from '@/components/canvas/table'
import { CanvasTabs, buildTabsExport, tabsSchema } from '@/components/canvas/tabs'
import { CanvasTag, buildTagExport, tagSchema } from '@/components/canvas/tag'
import { CanvasTitleText, buildTitleTextExport, titleTextSchema } from '@/components/canvas/title-text'
import type { ComponentDefinition } from '@/components/canvas/types'
import { genId } from '@/design/tree'
import type { DesignNode, NodeStyle } from '@/design/types'

export const componentRegistry: Record<string, ComponentDefinition> = {
  // B1：已挂 buildExport 的组件由 React/HTML 引擎经语义节点序列化；其余仍在引擎 switch 内
  // B1-2 全量：15+1（T9 icon）个组件全部挂 buildExport——React/HTML 引擎统一经语义节点序列化，引擎 switch 已移除
  button: { type: 'button', label: '按钮', Canvas: CanvasButton, buildExport: buildButtonExport, schema: buttonSchema },
  card: { type: 'card', label: '卡片', Canvas: CanvasCard, buildExport: buildCardExport, schema: cardSchema },
  input: { type: 'input', label: '输入框', Canvas: CanvasInput, buildExport: buildInputExport, schema: inputSchema },
  select: { type: 'select', label: '下拉选择', Canvas: CanvasSelect, buildExport: buildSelectExport, schema: selectSchema },
  table: { type: 'table', label: '表格', Canvas: CanvasTable, buildExport: buildTableExport, schema: tableSchema },
  chart: { type: 'chart', label: '图表', Canvas: CanvasChart, buildExport: buildChartExport, schema: chartSchema },
  'stat-block': { type: 'stat-block', label: '指标块', Canvas: CanvasStatBlock, buildExport: buildStatBlockExport, schema: statBlockSchema },
  navbar: { type: 'navbar', label: '顶部导航', Canvas: CanvasNavbar, buildExport: buildNavbarExport, schema: navbarSchema },
  sidebar: { type: 'sidebar', label: '侧边栏', Canvas: CanvasSidebar, buildExport: buildSidebarExport, schema: sidebarSchema },
  avatar: { type: 'avatar', label: '头像', Canvas: CanvasAvatar, buildExport: buildAvatarExport, schema: avatarSchema },
  tag: { type: 'tag', label: '标签', Canvas: CanvasTag, buildExport: buildTagExport, schema: tagSchema },
  divider: { type: 'divider', label: '分割线', Canvas: CanvasDivider, buildExport: buildDividerExport, schema: dividerSchema },
  'title-text': { type: 'title-text', label: '标题', Canvas: CanvasTitleText, buildExport: buildTitleTextExport, schema: titleTextSchema },
  hero: { type: 'hero', label: 'Hero 大图', Canvas: CanvasHero, buildExport: buildHeroExport, schema: heroSchema },
  image: { type: 'image', label: '图片', Canvas: CanvasImage, buildExport: buildImageExport, schema: imageSchema },
  icon: { type: 'icon', label: '图标', Canvas: CanvasIcon, buildExport: buildIconExport, schema: iconSchema },
  switch: { type: 'switch', label: '开关', Canvas: CanvasSwitch, buildExport: buildSwitchExport, schema: switchSchema },
  tabs: { type: 'tabs', label: '标签页', Canvas: CanvasTabs, buildExport: buildTabsExport, schema: tabsSchema },
}

/** 组件面板列表（按注册顺序） */
export const componentPalette = Object.values(componentRegistry).map(({ type, label }) => ({ type, label }))

// ---- 排版基元（面板「基础元素」区）----
// 只开放 text / rect / frame。group **有意不开放**：它与 frame 在渲染器是同一分支
// （NodeRenderer 的 frame||group 同一处理，画面零差异），双入口=伪选择。渲染层 group 分支
// 仅为旧稿兼容保留；新稿由后端 repair 归一化为 frame，schema enum 保留 group 同理（旧稿校验）。
export type PrimitiveType = 'text' | 'rect' | 'frame'

// as const satisfies 组合不是冗余修饰符：as const 把字段推成最窄字面量
// （primitivePalette[0].type 的类型是 'text' 而非 PrimitiveType），satisfies 只做形状检查
// 不改推断——删掉 as const 字段会被推宽，"锁死"失效。往 palette 顺手加成员（如 group）
// 必须先扩 PrimitiveType 字面量联合，类型层直接报错。
export const primitivePalette = [
  { type: 'text', label: '文本', icon: Type },
  { type: 'rect', label: '色块', icon: Square },
  { type: 'frame', label: '容器', icon: Frame },
] as const satisfies readonly { type: PrimitiveType; label: string; icon: LucideIcon }[]

/** 基元默认节点（默认值钉死，不让实施者猜）：
 * - text：图层树旧默认同款（fontSize 14），补 width 200 保证自由布局下可见；
 * - rect：background 用 'primary' 令牌（demoData 头像底同款用法）；
 * - frame：background 用 '#FFFFFF'——前端令牌表没有"卡片面"语义令牌，"不写死 hex"在此例外：
 *   取后端白名单 hex，与 templates.py 既定做法一致。
 * 历史教训：demoData 曾写 'card'（非令牌名）→ resolveColor 旧版静默放行 → 非法 CSS 色块隐形。
 * 现状：未知裸词被 resolveColor 显式丢弃 + dev 警告；demoData 已改 '#FFFFFF'；
 * colorContract.test 防数据再犯。 */
const PRIMITIVE_PRESETS: Record<PrimitiveType, { props?: DesignNode['props']; style: NodeStyle }> = {
  text: { props: { text: '文本' }, style: { fontSize: 14, width: 200 } },
  rect: { style: { width: 200, height: 80, radius: 12, background: 'primary' } },
  frame: { style: { width: 320, height: 200, layout: 'column', gap: 12, padding: 16, radius: 12, background: '#FFFFFF' } },
}

export function createPrimitiveNode(type: PrimitiveType): DesignNode {
  const preset = PRIMITIVE_PRESETS[type]
  // 显式返回 DesignNode：style 走上下文类型不被推宽——防未来 NodeStyle.background
  // 收紧成字面量联合时这里变成隐藏破坏点。
  return { id: genId(type), type, props: { ...preset.props }, style: { ...preset.style } }
}

/** 面板拖拽 payload：组件是裸 componentType（历史格式，e2e/画布依赖），基元加 primitive: 前缀。
 *  编码只有 ComponentPalette 一处写、解码只有 WorkspacePage.handleDropComponent 一处读，
 *  DesignCanvas 对 payload 透明（只判空，不校验值）——前缀不会被当非法类型静默丢弃。 */
export const PRIMITIVE_PAYLOAD_PREFIX = 'primitive:'

export function encodePaletteDragPayload(type: string, kind: 'component' | 'primitive'): string {
  return kind === 'primitive' ? `${PRIMITIVE_PAYLOAD_PREFIX}${type}` : type
}

export function parsePaletteDragPayload(raw: string): { kind: 'component' | 'primitive'; type: string } | null {
  if (raw.startsWith(PRIMITIVE_PAYLOAD_PREFIX)) {
    return { kind: 'primitive', type: raw.slice(PRIMITIVE_PAYLOAD_PREFIX.length) }
  }
  return raw ? { kind: 'component', type: raw } : null
}

export function isPrimitiveType(value: string): value is PrimitiveType {
  return primitivePalette.some((p) => p.type === value)
}

