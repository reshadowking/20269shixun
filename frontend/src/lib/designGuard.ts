/**
 * AI 角色边界前端拦截（缺陷 9）：发送前本地判断，无关请求不发请求、礼貌提示。
 * 与服务端 design_guard 规则一致（此处为快速反馈层，服务端兜底）。
 */
const PAGE_KEYWORDS = ['页面', '登录', '注册', '电商', '优惠', '商城', '购物', '仪表', '报表', '表单', '登记', '问卷', '列表', '订单', '文章', '博客', '落地页', '设置页', '个人主页', '首页', '导航', '课程', '详情页', '活动页']
const DESIGN_VERBS = ['设计', '生成', '创建', '做', '画', '把', '将', '改成', '改为', '变成', '调大', '调小', '放大', '缩小', '移动', '删除', '添加', '加个']
const UI_KEYWORDS = ['ui', '界面', '布局', '按钮', '颜色', '色彩', '间距', '圆角', '字体', '图标', '图片', '背景', '导航栏', '侧边栏', '卡片', '表格', '图表', '输入框', '下拉', '头像', '标签', '分割线', '标题', '画布', '设计稿', '样式']

export function isDesignRequest(prompt: string): boolean {
  if (PAGE_KEYWORDS.some((k) => prompt.includes(k))) return true
  const hasVerb = DESIGN_VERBS.some((v) => prompt.includes(v))
  const hasUi = UI_KEYWORDS.some((k) => prompt.toLowerCase().includes(k))
  return hasVerb && hasUi
}

export const GUARD_HINT = '我是 AI 设计助手，只负责 UI / 界面设计相关问题（页面布局、组件、颜色、间距、圆角等）。请描述你想要的设计稿，例如：「设计一个登录页」「把按钮改成红色」。'
