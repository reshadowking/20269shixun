/**
 * AI 角色边界前端拦截（缺陷 9）：发送前本地判断，无关请求不发请求、礼貌提示。
 * 与服务端 design_guard 规则一致（此处为快速反馈层，服务端兜底）。
 * 缺口清单 §4.6：新增「组件词+效果词」定向识别——「给所有卡片加阴影」这类"裸加+效果"
 * 句式不再误拦；不把裸"加"入动词表（否则"增加/加载/更加"都会放行，削弱角色边界）。
 */
// §4.6 方案 A：组件词/效果词的单一来源是 shared/design-guard-words.json——
// 与服务端 design_guard.py 共读同一文件（构建/运行时加载），杜绝两处手抄漂移。
import guardWords from '../../../shared/design-guard-words.json'

// T10 §2.3：三张基础词表与组件词/效果词同住 shared JSON（取前后端并集）——改词只改 JSON 一处
const PAGE_KEYWORDS: string[] = guardWords.pageKeywords
const DESIGN_VERBS: string[] = guardWords.designVerbs
const UI_KEYWORDS: string[] = guardWords.uiKeywords

export function isDesignRequest(prompt: string): boolean {
  if (PAGE_KEYWORDS.some((k) => prompt.includes(k))) return true
  const hasVerb = DESIGN_VERBS.some((v) => prompt.includes(v))
  const hasUi = UI_KEYWORDS.some((k) => prompt.toLowerCase().includes(k))
  if (hasVerb && hasUi) return true
  const hasComponent = guardWords.componentWords.some((k) => prompt.includes(k))
  const hasEffect = guardWords.effectWords.some((k) => prompt.includes(k))
  return hasComponent && hasEffect
}

export const GUARD_HINT = '我是 AI 设计助手，只负责 UI / 界面设计相关问题（页面布局、组件、颜色、间距、圆角等）。请描述你想要的设计稿，例如：「设计一个登录页」「把按钮改成红色」。'
