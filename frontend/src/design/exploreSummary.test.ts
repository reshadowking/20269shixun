/**
 * 方案摘要/对比（缺陷 1）：定位一行话 + 关键差异 3~5 条，全部来自设计树，零模型调用。
 */
import { describe, expect, it } from 'vitest'

import { compareOptions, luminance, optionPositioning, shortLabel, summarizeDesign } from './exploreSummary'
import type { DesignNode } from './types'

const LIGHT: DesignNode = {
  id: 'root',
  type: 'frame',
  style: { layout: 'column', width: 800, height: 600, background: '#F5F5F5' },
  children: [
    { id: 'nav', type: 'component', componentType: 'navbar', props: {} },
    { id: 'chart', type: 'component', componentType: 'chart', props: {} },
    { id: 'stat', type: 'component', componentType: 'stat-block', props: {} },
    { id: 'hidden', type: 'component', componentType: 'image', props: {}, hidden: true },
  ],
}

const DARK: DesignNode = {
  id: 'root',
  type: 'frame',
  style: { layout: 'grid', width: 800, height: 600, background: '#141414' },
  children: [
    { id: 'hero', type: 'component', componentType: 'hero', props: {}, style: { background: '#0052D9' } },
    { id: 'img', type: 'component', componentType: 'image', props: {} },
  ],
}

describe('exploreSummary', () => {
  it('luminance：白 1 / 黑 0 / 非法值 null', () => {
    expect(luminance('#FFFFFF')).toBeCloseTo(1, 3)
    expect(luminance('#000000')).toBeCloseTo(0, 3)
    expect(luminance('primary')).toBeNull()
  })

  it('summary：布局/色调/模块数/特色组件（隐藏节点不计入）', () => {
    const light = summarizeDesign(LIGHT)
    expect(light.layout).toBe('纵向分栏')
    expect(light.theme).toBe('浅色系')
    expect(light.modules).toBe(3) // hidden 图片不计
    expect(light.features).toEqual(['顶部导航', '图表', '指标块'])

    const dark = summarizeDesign(DARK)
    expect(dark.layout).toBe('网格布局')
    expect(dark.theme).toBe('深色系')
    expect(dark.modules).toBe(2)
    expect(dark.accent).toBe('#0052D9') // 首个饱和业务色（跳过近黑背景）
  })

  it('positioning：一句话定位含布局/色调/主色/特色组件', () => {
    expect(optionPositioning({ label: '方案一', design: LIGHT })).toBe(
      '纵向分栏 · 浅色系 · 含顶部导航、图表、指标块',
    )
    expect(optionPositioning({ label: '方案二', design: DARK })).toBe('网格布局 · 深色系 · 主色 #0052D9 · 含Hero 大图、图片')
  })

  it('compareOptions：不同方案给出 3~5 条差异，含双方短名', () => {
    const lines = compareOptions(
      { label: '方案一 · 默认风格', design: LIGHT, compliance: 92 },
      { label: '方案二 · 差异化风格', design: DARK, compliance: 100 },
    )
    expect(lines.length).toBeGreaterThanOrEqual(3)
    expect(lines.length).toBeLessThanOrEqual(5)
    expect(lines.join('\n')).toContain('布局：方案一 纵向分栏 / 方案二 网格布局')
    expect(lines.join('\n')).toContain('色调：方案一 浅色系 / 方案二 深色系')
    expect(lines.join('\n')).toContain('一级模块数：方案一 3 个 / 方案二 2 个')
    expect(lines.join('\n')).toContain('规范兼容率：方案一 92% / 方案二 100%')
  })

  it('compareOptions：方案相近时仍保底 3 条（明示相同而非编造差异）', () => {
    const lines = compareOptions({ label: '方案一', design: LIGHT }, { label: '方案二', design: LIGHT })
    expect(lines).toHaveLength(3)
    expect(lines[0]).toContain('布局相同')
    expect(lines[1]).toContain('色调相同')
    expect(lines[2]).toContain('一级模块数相同')
  })

  it('shortLabel：截取方案短名', () => {
    expect(shortLabel('方案一 · 默认风格')).toBe('方案一')
    expect(shortLabel('方案二')).toBe('方案二')
  })
})
