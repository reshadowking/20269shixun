/**
 * 协作 room 派生（P0-4）：Yjs 房间按设计隔离，避免多设计互相覆盖。
 * 优先级：显式 ?room=（E2E 与多人同稿共用入口）> 已存设计 design-{id} > 每标签随机 fallback。
 * 边界：未保存路径（空白/模板/草稿/新建）用随机 room——每标签独立、绝不互踩；
 * 代价是同浏览器两个草稿标签互不可见（草稿本为单机 localStorage 语义，可接受）。
 */
export function deriveCollabRoom(explicitRoom: string | null, designId: string | null, randomFallback: string): string {
  if (explicitRoom) return explicitRoom
  if (designId) return `design-${designId}`
  return randomFallback
}

/** 生成一次会话内稳定的随机 room（调用方用 useRef 懒初始化保证 StrictMode 安全） */
export function randomRoom(): string {
  return `local-${Math.random().toString(36).slice(2, 10)}`
}
