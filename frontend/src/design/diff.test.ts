/**
 * diffDesign（P0-1）：对比新旧设计树，返回被修改/新增/删除的节点 id。
 */
import { describe, expect, it } from 'vitest'

import type { DesignNode } from '@/design/types'

import { diffDesign } from './diff'

const OLD: DesignNode = {
  id: 'root',
  type: 'frame',
  style: { layout: 'column' },
  children: [
    { id: 'title', type: 'text', props: { text: '商品标题' }, style: { color: 'text-primary' } },
    { id: 'buy', type: 'component', componentType: 'button', props: { text: '加入购物车' }, style: { width: 160 } },
    { id: 'note', type: 'text', props: { text: '包邮' } },
  ],
}

describe('diffDesign', () => {
  it('无变化返回空', () => {
    expect(diffDesign(OLD, JSON.parse(JSON.stringify(OLD)))).toEqual([])
  })

  it('只改一个节点的样式 → 只返回该节点', () => {
    const next = JSON.parse(JSON.stringify(OLD))
    next.children[1].style.width = 200
    next.children[1].style.color = 'danger'
    const changed = diffDesign(OLD, next)
    expect(changed).toEqual(['buy'])
  })

  it('改文本内容 → 返回该节点', () => {
    const next = JSON.parse(JSON.stringify(OLD))
    next.children[0].props.text = '新标题'
    expect(diffDesign(OLD, next)).toEqual(['title'])
  })

  it('新增节点 → 返回新节点及子树', () => {
    const next = JSON.parse(JSON.stringify(OLD))
    next.children.push({ id: 'img', type: 'component', componentType: 'image', props: {}, children: [{ id: 'img-sub', type: 'text', props: { text: 'x' } }] })
    const changed = diffDesign(OLD, next)
    expect(changed).toContain('img')
    expect(changed).toContain('img-sub')
  })

  it('删除节点 → 返回被删节点', () => {
    const next = JSON.parse(JSON.stringify(OLD))
    next.children = next.children.filter((c: { id: string }) => c.id !== 'note')
    expect(diffDesign(OLD, next)).toEqual(['note'])
  })

  it('子节点位置交换不算修改（按 id 匹配）', () => {
    const next = JSON.parse(JSON.stringify(OLD))
    const children = next.children
    ;[children[0], children[2]] = [children[2], children[0]]
    expect(diffDesign(OLD, next)).toEqual([])
  })
})
