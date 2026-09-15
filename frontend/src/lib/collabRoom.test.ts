/**
 * 协作 room 派生测试（P0-4：Yjs 房间按设计隔离，防多设计互相覆盖）。
 */
import { describe, expect, it } from 'vitest'

import { deriveCollabRoom, randomRoom, usesSignedRoom } from './collabRoom'

describe('deriveCollabRoom', () => {
  it('显式 ?room=（E2E/多人同稿）最高优先', () => {
    expect(deriveCollabRoom('room-e2e', '12', 's-abc12345')).toBe('room-e2e')
  })

  it('打开已存设计按 design-{id} 派生（同设计双标签协作可用）', () => {
    expect(deriveCollabRoom(null, '42', 's-abc12345')).toBe('design-42')
    expect(deriveCollabRoom(null, '42', 's-other999')).toBe('design-42')
  })

  it('未保存路径（新建/模板/草稿）按会话 key 稳定派生（缺陷 4：刷新/双标签回到同一房间）', () => {
    expect(deriveCollabRoom(null, null, 's-x1x1x1x')).toBe('session-s-x1x1x1x')
    expect(deriveCollabRoom(null, null, 's-x1x1x1x')).toBe('session-s-x1x1x1x')
    expect(deriveCollabRoom(null, null, 's-another1')).toBe('session-s-another1')
  })

  it('randomRoom 每次生成不同（防两标签共用草稿 room）', () => {
    expect(randomRoom()).not.toBe(randomRoom())
  })
})

describe('usesSignedRoom（§三.1：已保存稿件走签发房间，草稿不走网关）', () => {
  const GW = 'ws://localhost:1235'

  it('已保存稿件 + 配了网关 + 无显式 room → 走签发房间', () => {
    expect(usesSignedRoom(null, '42', GW)).toBe(true)
  })

  it('草稿（没有 design 参数）→ 不走网关', () => {
    expect(usesSignedRoom(null, null, GW)).toBe(false)
  })

  it('没配网关地址 → 行为与改造前一致（全部直连）', () => {
    expect(usesSignedRoom(null, '42', undefined)).toBe(false)
    expect(usesSignedRoom(null, '42', '')).toBe(false)
  })

  it('显式 ?room=（E2E / 多人同稿入口）→ 保持直连', () => {
    expect(usesSignedRoom('room-e2e', '42', GW)).toBe(false)
  })
})
