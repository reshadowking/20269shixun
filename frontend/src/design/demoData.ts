import type { DesignNode } from './types'

/**
 * 演示设计稿（来自 设计稿示例demo.html 的三个示例转 DesignNode）。
 * 阶段 1 用于画布 POC 验证；阶段 3 起由 AI 生成引擎产出同构数据。
 */
export const DEMO_COUPON: DesignNode = {
  id: 'coupon-root',
  type: 'frame',
  style: { layout: 'column', gap: 16, background: '#FFF0F0', padding: 32, width: 720 },
  children: [
    {
      id: 'coupon-title',
      type: 'component',
      componentType: 'title-text',
      props: { text: '618 狂欢 · 限时领券', level: 2 },
      style: { align: 'center', color: 'text-primary' },
    },
    {
      id: 'coupon-sub',
      type: 'text',
      props: { text: '满减优惠券，先到先得，每人限领 3 张' },
      style: { align: 'center', color: 'text-secondary', fontSize: 13 },
    },
    {
      id: 'coupon-row',
      type: 'frame',
      style: { layout: 'row', gap: 24, justifyContent: 'center' },
      children: [
        {
          id: 'coupon-1',
          type: 'component',
          componentType: 'button',
          props: { text: '¥50  满199可用', variant: 'primary' },
          style: { width: 220, height: 96, radius: 12, background: '#FFFFFF', color: 'danger', fontSize: 16 },
        },
        {
          id: 'coupon-2',
          type: 'component',
          componentType: 'button',
          props: { text: '¥100  满399可用', variant: 'primary' },
          style: { width: 220, height: 96, radius: 12, background: '#FFFFFF', color: 'danger', fontSize: 16 },
        },
        {
          id: 'coupon-3',
          type: 'component',
          componentType: 'button',
          props: { text: '¥200  满799可用', variant: 'primary' },
          style: { width: 220, height: 96, radius: 12, background: '#FFFFFF', color: 'danger', fontSize: 16 },
        },
      ],
    },
    {
      id: 'coupon-note',
      type: 'text',
      props: { text: '活动时间：9月1日 - 9月15日 · 领取后 7 天内有效' },
      style: { align: 'center', color: 'text-light', fontSize: 12 },
    },
  ],
}

export const DEMO_LOGIN: DesignNode = {
  id: 'login-root',
  type: 'frame',
  style: { layout: 'column', gap: 16, background: 'background', padding: 40, width: 380, radius: 12 },
  children: [
    {
      id: 'login-logo',
      type: 'component',
      componentType: 'avatar',
      props: { name: 'P' },
      style: { width: 44, height: 44, radius: 12, background: 'primary', color: '#FFFFFF', fontSize: 18 },
    },
    {
      id: 'login-title',
      type: 'component',
      componentType: 'title-text',
      props: { text: '欢迎回来', level: 3 },
      style: { color: 'text-primary' },
    },
    {
      id: 'login-field-1',
      type: 'component',
      componentType: 'input',
      props: { label: '账号', placeholder: '请输入邮箱或手机号' },
      style: { width: 320 },
    },
    {
      id: 'login-field-2',
      type: 'component',
      componentType: 'input',
      props: { label: '密码', placeholder: '请输入密码', type_: 'password' },
      style: { width: 320 },
    },
    {
      id: 'login-btn',
      type: 'component',
      componentType: 'button',
      props: { text: '登 录', variant: 'primary' },
      style: { width: 320, height: 44, color: 'primary', background: 'primary' },
    },
  ],
}

export const DEMO_DASHBOARD: DesignNode = {
  id: 'dash-root',
  type: 'frame',
  style: { layout: 'row', gap: 0, background: 'background', radius: 16, width: 720 },
  children: [
    {
      id: 'dash-side',
      type: 'frame',
      style: { layout: 'column', gap: 8, width: 160, background: '#1D2129', padding: 24 },
      children: [
        { id: 'dash-brand', type: 'text', props: { text: 'FinBoard' }, style: { color: '#FFFFFF', fontSize: 16, fontWeight: 700 } },
        { id: 'dash-item-1', type: 'text', props: { text: '总览' }, style: { color: '#B8BEC9', fontSize: 13, background: 'primary' } },
        { id: 'dash-item-2', type: 'text', props: { text: '交易记录' }, style: { color: '#B8BEC9', fontSize: 13 } },
        { id: 'dash-item-3', type: 'text', props: { text: '资产分析' }, style: { color: '#B8BEC9', fontSize: 13 } },
      ],
    },
    {
      id: 'dash-main',
      type: 'frame',
      style: { layout: 'column', gap: 20, padding: 24, flex: 1 },
      children: [
        {
          id: 'dash-title',
          type: 'component',
          componentType: 'title-text',
          props: { text: '经营总览', level: 2 },
          style: { color: 'text-primary' },
        },
        {
          id: 'dash-stats',
          type: 'frame',
          style: { layout: 'row', gap: 16 },
          children: [
            { id: 'dash-stat-1', type: 'rect', props: {}, style: { width: 150, height: 80, radius: 12, background: 'card', border: '1px solid #EEF0F4' } },
            { id: 'dash-stat-2', type: 'rect', props: {}, style: { width: 150, height: 80, radius: 12, background: 'card', border: '1px solid #EEF0F4' } },
          ],
        },
        {
          id: 'dash-chart',
          type: 'component',
          componentType: 'chart',
          props: {
            chartType: 'bar',
            title: '近 7 日营收趋势',
            data: [
              { day: '周一', value: 45 }, { day: '周二', value: 68 },
              { day: '周三', value: 52 }, { day: '周四', value: 82 },
              { day: '周五', value: 60 }, { day: '周六', value: 92 },
              { day: '周日', value: 74 },
            ],
            xKey: 'day',
            yKey: 'value',
          },
          style: { width: 480, height: 200 },
        },
      ],
    },
  ],
}

export const DEMO_FREE: DesignNode = {
  id: 'free-root',
  type: 'frame',
  style: { layout: 'free', width: 800, height: 600, background: '#FFFFFF' },
  children: [
    {
      id: 'free-title',
      type: 'component',
      componentType: 'title-text',
      props: { text: '自由布局画布', level: 2 },
      style: { color: 'text-primary' },
      x: 40, y: 40,
    },
    {
      id: 'free-btn-1',
      type: 'component',
      componentType: 'button',
      props: { text: '按钮 A', variant: 'primary' },
      style: { width: 160, height: 44 },
      x: 40, y: 120,
    },
    {
      id: 'free-btn-2',
      type: 'component',
      componentType: 'button',
      props: { text: '按钮 B' },
      style: { width: 160, height: 44 },
      x: 320, y: 120,
    },
    {
      id: 'free-card',
      type: 'component',
      componentType: 'card',
      props: { title: '自由卡片', content: '拖我到任意位置（free 布局直接改 x/y）' },
      style: { width: 260 },
      x: 40, y: 220,
    },
    {
      id: 'free-img',
      type: 'component',
      componentType: 'image',
      props: { alt: '占位图' },
      style: { width: 220, height: 140 },
      x: 360, y: 220,
    },
  ],
}

export const DEMO_DESIGNS: DesignNode[] = [DEMO_COUPON, DEMO_LOGIN, DEMO_DASHBOARD, DEMO_FREE]

export const DEMO_DESIGN_META: Array<{ key: string; label: string }> = [
  { key: 'coupon', label: '优惠券页' },
  { key: 'login', label: '登录页' },
  { key: 'dashboard', label: '仪表盘' },
  { key: 'free', label: '自由布局' },
]

/** 空白画布起点（缺陷 5/8：新建空白设计，自由布局可拖拽） */
export const BLANK_DESIGN: DesignNode = {
  id: 'blank-root',
  type: 'frame',
  style: { layout: 'free', width: 1200, height: 800, background: 'background' },
  children: [],
}
