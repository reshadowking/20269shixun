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

/**
 * 协作是否走网关（`VITE_WS_GATEWAY_URL`）。
 *
 * 2026-09-16 收紧：**配了网关就所有协作流量都过网关**——包括草稿与显式 `?room=`。
 * 原来草稿走直连，等于留了个后门：只要 y-websocket 端口对外，谁都能连上写。
 * 现在网关对草稿房间要求**合法 JWT**（房间名当共享凭证），配合 compose 不再把
 * y-websocket 暴露到宿主机，直连这条路才真正关掉。
 *
 * 没配网关时返回 false：行为与改造前完全一致（直连 `VITE_WS_URL`）。
 */
export function usesGateway(gatewayUrl?: string): boolean {
  return Boolean(gatewayUrl)
}

/**
 * 是否必须等**服务端签发**房间名再连：只有"已保存稿件、且没有显式指定房间"才需要。
 * - 草稿没有稿件行、签不出房间 → 用本地派生的 `session-*`；
 * - 显式 `?room=`（E2E / 多人同稿入口）优先级最高 → 用它给的名字（仍是过网关）。
 */
export function needsSignedRoom(designId: string | null, explicitRoom: string | null): boolean {
  return Boolean(designId && !explicitRoom)
}
