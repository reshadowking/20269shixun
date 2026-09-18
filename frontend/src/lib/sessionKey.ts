/**
 * 会话身份派生（缺陷 4）：一个画布 = 一个会话。
 *
 * 优先级：URL 显式 ?session= > 已保存设计 ?design={id}（服务端登记的会话 > s-design-{id}）
 *        > 新建随机 s-xxxxxxxx。
 * 进入工作台时会把 session 写回 URL（replace），因此刷新/分享/回退都指向同一会话。
 */
export const SESSION_PARAM = 'session'

const RANDOM_RE = /^s-[a-z0-9]{8}$/

/** 已保存设计的会话 key（同一设计在任何浏览器打开都是同一会话） */
export function designSessionKey(designId: string | number): string {
  return `s-design-${designId}`
}

import { randomToken } from '@/lib/randomToken'

/**
 * 新建会话 key（8 位随机，符合后端 ^[A-Za-z0-9_-]{3,64}$ 校验）。
 *
 * ⚠️ 这个 key 会派生成草稿协作房间名（`session-{key}`），也就是一张共享凭证——
 * 所以必须用 CSPRNG，不能用 Math.random（见 lib/randomToken.ts 的说明）。
 */
export function randomSessionKey(): string {
  return `s-${randomToken(8)}`
}

export function isSessionKey(value: string | null | undefined): boolean {
  return Boolean(value && /^[A-Za-z0-9_-]{3,64}$/.test(value))
}

/**
 * 派生当前会话 key。
 * - 显式 ?session= 合法 → 直接用（会话切换即换 URL）
 * - ?design={id} → s-design-{id}
 * - 否则 randomKey（由调用方懒初始化，保证 StrictMode 下稳定）
 */
export function deriveSessionKey(
  sessionParam: string | null | undefined,
  designParam: string | null | undefined,
  randomKey: string,
  /**
   * 服务端登记的"该设计原本的会话"（见 `sessionApi.findSessionKeyForDesign`）。
   * 保存前的画布用的是随机会话，只有这个绑定能指向真正聊过的那条会话；
   * 缺省 / 非法值一律退化为 `s-design-{id}`（改造前行为）。
   */
  boundKey?: string | null,
): string {
  if (isSessionKey(sessionParam)) return sessionParam as string
  if (designParam) return isSessionKey(boundKey) ? (boundKey as string) : designSessionKey(designParam)
  return randomKey
}

/** 该会话是否绑定已保存设计（决定 URL 是否带 design 参数） */
export function designIdFromSessionKey(sessionKey: string): string | null {
  const m = /^s-design-(\d+)$/.exec(sessionKey)
  return m ? m[1] : null
}

/** 会话 key 是否形如随机 key（用于 UI 判断"未保存画布会话"） */
export function isRandomSessionKey(sessionKey: string): boolean {
  return RANDOM_RE.test(sessionKey)
}
