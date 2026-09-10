/**
 * 会话作用域（缺陷 4）：跨会话访问被拒绝 + 写入盖章 + 读取过滤。
 * 这是"用会话 B 的 id 读会话 A 上下文被拒绝"的客户端落点（服务端另有对称强制）。
 */
import { describe, expect, it } from 'vitest'

import {
  CrossSessionAccessError,
  assertSameSession,
  createSessionScope,
  filterOwnMessages,
  stampMessages,
} from './sessionScope'

describe('会话作用域强制', () => {
  it('跨会话读取被拒绝（抛 CrossSessionAccessError，不返回数据）', () => {
    const scopeB = createSessionScope('s-b')
    expect(() => scopeB.assertOwns('s-a')).toThrow(CrossSessionAccessError)
    expect(() => scopeB.assertOwns('s-a')).toThrow(/跨会话访问被拒绝/)
    // 本会话/未声明（历史数据）放行
    expect(() => scopeB.assertOwns('s-b')).not.toThrow()
    expect(() => scopeB.assertOwns(undefined)).not.toThrow()
  })

  it('空 sessionKey 直接拒绝（不允许"无会话"兜底通道）', () => {
    expect(() => createSessionScope('')).toThrow(CrossSessionAccessError)
    expect(() => assertSameSession('', 's-a')).toThrow(CrossSessionAccessError)
  })

  it('写入盖章：每条消息都带正确 sessionId', () => {
    const scope = createSessionScope('s-a')
    const stamped = scope.stamp([{ role: 'user', text: '你好' }, { role: 'assistant', text: '收到' }])
    expect(stamped.map((m) => m.sessionId)).toEqual(['s-a', 's-a'])
    expect(stampMessages('s-x', [{ role: 'user', text: 't' }])[0].sessionId).toBe('s-x')
  })

  it('读取过滤：外来会话消息被丢弃并计数', () => {
    const own = { role: 'user', text: '本会话', sessionId: 's-a' }
    const foreign = { role: 'user', text: '别的会话', sessionId: 's-b' }
    const legacy = { role: 'user', text: '无归属（迁移数据）' }
    const { messages, dropped } = filterOwnMessages('s-a', [own, foreign, legacy])
    expect(messages.map((m) => m.text)).toEqual(['本会话', '无归属（迁移数据）'])
    expect(dropped).toBe(1)
  })

  it('scopedKey：本地键按会话分片，两会话互不覆盖', () => {
    const a = createSessionScope('s-a')
    const b = createSessionScope('s-b')
    expect(a.scopedKey('design-draft')).toBe('design-draft-s-a')
    expect(b.scopedKey('design-draft')).toBe('design-draft-s-b')
    expect(a.scopedKey('design-draft')).not.toBe(b.scopedKey('design-draft'))
  })

  it('scope 对象经 filter/stamp 往返后不丢失本会话数据', () => {
    const scope = createSessionScope('s-a')
    const roundTrip = scope.filter(scope.stamp([{ role: 'user', text: 'x' }]))
    expect(roundTrip.dropped).toBe(0)
    expect(roundTrip.messages[0].sessionId).toBe('s-a')
  })
})
