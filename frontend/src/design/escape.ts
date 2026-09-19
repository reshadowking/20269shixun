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

/** img/media src 协议白名单：http/https/data:image/锚点/相对路径；其余一律置空。
 * 匹配前先 trim 并剥离控制字符，防止 scheme 伪装（如 "java\nscript:"）。 */
export function safeSrc(src: string | undefined): string {
  if (!src) return ''
  const cleaned = src.trim().replace(/[\u0000-\u001f\u007f]/g, '')
  if (/^(https?:|data:image\/|#|\/|\.\.?\/)/i.test(cleaned)) return cleaned
  return ''
}

/** 导出产物里渲染 JSX 字符串属性时的转义（与 escapeHtml 同源，显式别名） */
export const escapeJsxAttr = escapeHtml

/**
 * **JSX 文本位**转义：escapeHtml + 花括号实体化（2026-09-17）。
 *
 * 为什么不能直接复用 escapeHtml：JSX 的文本位会把 `{…}` 当**表达式容器**，
 * 而 HTML 的文本位只是字面量。于是同一段文本在两通道行为不同——
 * 实测（真实 TS 编译器）：
 *   裸 `<div>总价 {价格} 元</div>` → `Cannot find name '价格'.`（导出工程编译不过/运行期白屏），
 *   裸 `<div>{1 +}</div>`        → `Expression expected.`（语法错）；
 *   `<div>总价 &#123;价格&#125; 元</div>` → 干净（实体在 JSX 文本里会被解码成字面 `{`）。
 * 属性位（`attr="…"`）里的花括号是安全的，仍用 escapeHtml。
 */
export function escapeJsxText(input: string): string {
  return escapeHtml(input).replace(/\{/g, '&#123;').replace(/\}/g, '&#125;')
}
