/**
 * 组件注册表（v2.2 §5.2/5.3）：画布渲染 / 导出引擎 / 组件面板 / 属性面板统一从这里读取。
 * 新增组件 = 一个文件夹（四份定义）+ 这里登记一行 + 测试。
 */
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
import { CanvasTag, buildTagExport, tagSchema } from '@/components/canvas/tag'
import { CanvasTitleText, buildTitleTextExport, titleTextSchema } from '@/components/canvas/title-text'

import type { ComponentDefinition } from '@/components/canvas/types'

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
}

/** 组件面板列表（按注册顺序） */
export const componentPalette = Object.values(componentRegistry).map(({ type, label }) => ({ type, label }))

