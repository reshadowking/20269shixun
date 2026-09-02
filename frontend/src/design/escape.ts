/**
 * 导出/渲染的安全工具（v2.2 §11.2 XSS 双通道防线的公共件）。
 * 渲染通道：React 默认转义，禁 dangerouslySetInnerHTML；
 * 导出通道：所有用户字符串必须经 escapeHtml，href 必须经 safeHref 协议白名单。
 */

export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** href 协议白名单：http/https/mailto/锚点/相对路径；其余一律降级为 '#' */
export function safeHref(href: string | undefined): string {
  if (!href) return '#'
  if (/^(https?:|mailto:|#|\/|\.\.?\/)/i.test(href)) return href
  return '#'
}

/** 导出产物里渲染 JSX 字符串属性时的转义（与 escapeHtml 同源，显式别名） */
export const escapeJsxAttr = escapeHtml
