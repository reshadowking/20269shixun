/**
 * 会话作用域（缺陷 4）：会话数据的唯一读写入口，"跨会话读取被拒绝"的客户端落点。
 *
 * 规则：
 * - 作用域对象只认自己那一个 sessionKey；任何带外 key 的访问直接抛 CrossSessionAccessError；
 * - 写消息时盖 sessionId 章，读消息时校验（外来消息被丢弃并计数），从数据面杜绝串写；
 * - 服务端同样强制（owner + 路径/声明一致），两端互补。
 */
export interface SessionMessageLike {
  role: string
  text: string
  /** 归属会话（写入时盖章；读取时校验） */
  sessionId?: string
}

export class CrossSessionAccessError extends Error {
  constructor(scopeKey: string, targetKey: string) {
    super(`跨会话访问被拒绝：当前会话 ${scopeKey}，目标会话 ${targetKey}`)
    this.name = 'CrossSessionAccessError'
  }
}

/** 断言目标 key 属于当前会话；不一致即拒绝（服务端同名规则的前端对称实现） */
export function assertSameSession(scopeKey: string, targetKey: string | null | undefined): void {
  if (!scopeKey) throw new CrossSessionAccessError(scopeKey, String(targetKey))
  if (targetKey == null || targetKey === '') return
  if (targetKey !== scopeKey) throw new CrossSessionAccessError(scopeKey, targetKey)
}

/** 写入前盖章：保证每条消息都带正确 sessionId */
export function stampMessages<T extends SessionMessageLike>(scopeKey: string, messages: T[]): Array<T & { sessionId: string }> {
  return messages.map((m) => ({ ...m, sessionId: scopeKey }))
}

/**
 * 读取时过滤：只返回本会话消息；外来消息（sessionId 不匹配）被丢弃。
 * 返回 dropped 数量供 UI/测试断言（正常情况下应为 0）。
 */
export function filterOwnMessages<T extends SessionMessageLike>(
  scopeKey: string,
  messages: T[],
): { messages: T[]; dropped: number } {
  const own: T[] = []
  let dropped = 0
  for (const m of messages) {
    if (m.sessionId !== undefined && m.sessionId !== scopeKey) {
      dropped += 1
      continue
    }
    own.push(m)
  }
  return { messages: own, dropped }
}

export interface SessionScope {
  readonly sessionKey: string
  /** 断言目标属于本会话（不一致抛错） */
  assertOwns(targetKey: string | null | undefined): void
  /** 盖章写入 */
  stamp<T extends SessionMessageLike>(messages: T[]): Array<T & { sessionId: string }>
  /** 过滤读取（丢弃外来消息并计数） */
  filter<T extends SessionMessageLike>(messages: T[]): { messages: T[]; dropped: number }
  /** localStorage 键前缀（草稿/探索留档/基础版快照/会话快照共用） */
  scopedKey(base: string): string
}

export function createSessionScope(sessionKey: string): SessionScope {
  assertSameSession(sessionKey, sessionKey)
  return {
    sessionKey,
    assertOwns: (targetKey) => assertSameSession(sessionKey, targetKey),
    stamp: (messages) => stampMessages(sessionKey, messages),
    filter: (messages) => filterOwnMessages(sessionKey, messages),
    scopedKey: (base) => `${base}-${sessionKey}`,
  }
}
