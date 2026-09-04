/**
 * 组件注册表（v2.2 §5.2/5.3）：画布渲染 / 导出引擎 / 组件面板 / 属性面板统一从这里读取。
 * 新增组件 = 一个文件夹（四份定义）+ 这里登记一行 + 测试。
 */
import { CanvasAvatar, exportAvatarTemplate, avatarSchema } from '@/components/canvas/avatar'
import { CanvasButton, buildButtonExport, exportButtonTemplate, buttonSchema } from '@/components/canvas/button'
import { CanvasCard, exportCardTemplate, cardSchema } from '@/components/canvas/card'
import { CanvasChart, exportChartTemplate, chartSchema } from '@/components/canvas/chart'
import { CanvasDivider, exportDividerTemplate, dividerSchema } from '@/components/canvas/divider'
import { CanvasHero, exportHeroTemplate, heroSchema } from '@/components/canvas/hero'
import { CanvasImage, buildImageExport, exportImageTemplate, imageSchema } from '@/components/canvas/image'
import { CanvasInput, exportInputTemplate, inputSchema } from '@/components/canvas/input'
import { CanvasNavbar, exportNavbarTemplate, navbarSchema } from '@/components/canvas/navbar'
import { CanvasSelect, exportSelectTemplate, selectSchema } from '@/components/canvas/select'
import { CanvasSidebar, exportSidebarTemplate, sidebarSchema } from '@/components/canvas/sidebar'
import { CanvasStatBlock, exportStatBlockTemplate, statBlockSchema } from '@/components/canvas/stat-block'
import { CanvasTable, exportTableTemplate, tableSchema } from '@/components/canvas/table'
import { CanvasTag, exportTagTemplate, tagSchema } from '@/components/canvas/tag'
import { CanvasTitleText, exportTitleTextTemplate, titleTextSchema } from '@/components/canvas/title-text'

import type { ComponentDefinition } from '@/components/canvas/types'

export const componentRegistry: Record<string, ComponentDefinition> = {
  // B1 试点：button/image 已挂 buildExport（React/HTML 引擎经它序列化）；其余组件仍在引擎 switch 内
  button: { type: 'button', label: '按钮', Canvas: CanvasButton, exportTemplate: exportButtonTemplate, buildExport: buildButtonExport, schema: buttonSchema },
  card: { type: 'card', label: '卡片', Canvas: CanvasCard, exportTemplate: exportCardTemplate, schema: cardSchema },
  input: { type: 'input', label: '输入框', Canvas: CanvasInput, exportTemplate: exportInputTemplate, schema: inputSchema },
  select: { type: 'select', label: '下拉选择', Canvas: CanvasSelect, exportTemplate: exportSelectTemplate, schema: selectSchema },
  table: { type: 'table', label: '表格', Canvas: CanvasTable, exportTemplate: exportTableTemplate, schema: tableSchema },
  chart: { type: 'chart', label: '图表', Canvas: CanvasChart, exportTemplate: exportChartTemplate, schema: chartSchema },
  'stat-block': { type: 'stat-block', label: '指标块', Canvas: CanvasStatBlock, exportTemplate: exportStatBlockTemplate, schema: statBlockSchema },
  navbar: { type: 'navbar', label: '顶部导航', Canvas: CanvasNavbar, exportTemplate: exportNavbarTemplate, schema: navbarSchema },
  sidebar: { type: 'sidebar', label: '侧边栏', Canvas: CanvasSidebar, exportTemplate: exportSidebarTemplate, schema: sidebarSchema },
  avatar: { type: 'avatar', label: '头像', Canvas: CanvasAvatar, exportTemplate: exportAvatarTemplate, schema: avatarSchema },
  tag: { type: 'tag', label: '标签', Canvas: CanvasTag, exportTemplate: exportTagTemplate, schema: tagSchema },
  divider: { type: 'divider', label: '分割线', Canvas: CanvasDivider, exportTemplate: exportDividerTemplate, schema: dividerSchema },
  'title-text': { type: 'title-text', label: '标题', Canvas: CanvasTitleText, exportTemplate: exportTitleTextTemplate, schema: titleTextSchema },
  hero: { type: 'hero', label: 'Hero 大图', Canvas: CanvasHero, exportTemplate: exportHeroTemplate, schema: heroSchema },
  image: { type: 'image', label: '图片', Canvas: CanvasImage, exportTemplate: exportImageTemplate, buildExport: buildImageExport, schema: imageSchema },
}

/** 组件面板列表（按注册顺序） */
export const componentPalette = Object.values(componentRegistry).map(({ type, label }) => ({ type, label }))

/** 导出模板统一入口（导出引擎消费，v2.2 §6.2：只走模板拼装） */
export function renderExportTemplate(type: string, props: Record<string, unknown>): string {
  const def = componentRegistry[type]
  if (!def) return `{/* 未注册组件：${type} */}`
  return def.exportTemplate(props)
}
