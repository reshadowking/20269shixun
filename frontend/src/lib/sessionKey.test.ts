/**
 * 会话身份派生（缺陷 4）：?session= > ?design={id} 派生 > 新建随机。
 */
import { describe, expect, it } from 'vitest'

import { deriveSessionKey, designIdFromSessionKey, designSessionKey, isRandomSessionKey, isSessionKey, randomSessionKey } from './sessionKey'

describe('sessionKey 派生', () => {
  it('显式 ?session= 最高优先（切会话即换 URL）', () => {
    expect(deriveSessionKey('s-explicit1', '42', 's-random11')).toBe('s-explicit1')
  })

  it('?design={id} 派生 s-design-{id}（同一设计在任何浏览器都是同一会话）', () => {
    expect(deriveSessionKey(null, '42', 's-random11')).toBe('s-design-42')
    expect(designSessionKey(42)).toBe('s-design-42')
  })

  it('缺陷 5：服务端登记的会话优先于 s-design-{id}（保存前的随机 key 才是真对话）', () => {
    expect(deriveSessionKey(null, '42', 's-random11', 's-rand1234')).toBe('s-rand1234')
    // 绑定值非法（脏数据/空）→ 退化，不能把脏 key 带进后端 422
    expect(deriveSessionKey(null, '42', 's-random11', 'bad key!')).toBe('s-design-42')
    expect(deriveSessionKey(null, '42', 's-random11', null)).toBe('s-design-42')
  })

  it('URL 显式 ?session= 仍然最高优先（绑定值只补在缺省时）', () => {
    expect(deriveSessionKey('s-explicit1', '42', 's-random11', 's-rand1234')).toBe('s-explicit1')
  })

  it('绑定值只在 ?design= 分支生效：未保存画布不受影响（不会串到别人的会话）', () => {
    expect(deriveSessionKey(null, null, 's-random11', 's-rand1234')).toBe('s-random11')
  })

  it('无会话无设计 → 用调用方给的随机 key', () => {
    expect(deriveSessionKey(null, null, 's-random11')).toBe('s-random11')
    expect(deriveSessionKey(undefined, undefined, 's-random11')).toBe('s-random11')
  })

  it('非法 ?session= 视为缺省（防脏参数导致后端 422）', () => {
    expect(deriveSessionKey('bad key!', '7', 's-random11')).toBe('s-design-7')
    expect(deriveSessionKey('bad key!', null, 's-random11')).toBe('s-random11')
  })

  it('randomSessionKey 符合后端白名单且两次不同', () => {
    const a = randomSessionKey()
    expect(isSessionKey(a)).toBe(true)
    expect(a).not.toBe(randomSessionKey())
    expect(isRandomSessionKey(a)).toBe(true)
  })

  it('designIdFromSessionKey 反映会话与设计的绑定关系', () => {
    expect(designIdFromSessionKey('s-design-42')).toBe('42')
    expect(designIdFromSessionKey('s-abcd1234')).toBeNull()
  })
})
