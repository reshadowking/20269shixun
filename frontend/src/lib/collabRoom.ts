/**
 * 协作 room 派生（P0-4 + 缺陷 4）：Yjs 房间按"设计 / 会话"隔离，避免多画布互相覆盖。
 * 优先级：显式 ?room=（E2E 与多人同稿共用入口）> 已存设计 design-{id} > 会话 session-{sessionKey}。
 * 缺陷 4 变化：未保存画布不再用"每标签随机 room"，而是按会话 key 稳定派生——
 * 刷新/双标签回到同一房间（内容可从 leveldb 恢复），不同会话天然不同房间、绝不互踩。
 */
export function deriveCollabRoom(
  explicitRoom: string | null,
  designId: string | null,
  sessionKey: string,
  randomFallback?: string,
): string {
  if (explicitRoom) return explicitRoom
  if (designId) return `design-${designId}`
  if (sessionKey) return `session-${sessionKey}`
  return randomFallback ?? 'design-room'
}

/** 生成一次会话内稳定的随机 room（调用方用 useRef 懒初始化保证 StrictMode 安全） */
export function randomRoom(): string {
  return `local-${Math.random().toString(36).slice(2, 10)}`
}
