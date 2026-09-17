/**
 * 只接受**站内路径**的 `?redirect=` 参数（2026-09-17）。
 *
 * 背景：登录/注册页原来只判断 `startsWith('/')`，而 `//evil.com` 也以 `/` 开头 ——
 * 它是"协议相对 URL"，浏览器会当作跨站地址（`/\evil.com` 属同类变体，部分浏览器会把
 * 反斜杠归一成 `/`）。实测 React Router 在 jsdom 下直接抛 `External navigation is not allowed`
 * （真实浏览器里是 `history.pushState` 的 SecurityError），于是**登录/注册成功后页面反而报错卡住**。
 *
 * 规则：必须是「单个 `/` 开头的站内路径」，其余一律回落到首页 `/`。
 */
export function safeInternalPath(target: string | null | undefined): string {
  if (!target) return '/'
  if (!target.startsWith('/')) return '/'
  if (target.startsWith('//') || target.startsWith('/\\')) return '/'
  return target
}
