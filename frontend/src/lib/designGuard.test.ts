/**
 * AI 角色边界前端守卫测试（缺陷 9 + 缺口清单 §4.6）：
 * 无关请求拦截（不发请求、礼貌提示），设计请求放行。
 * 「组件词+效果词」定向识别的正反例双向覆盖（不引入裸"加"动词）。
 * §4.6 方案 A：词表单一来源 shared/design-guard-words.json（前后端共读，防人工同步漂移）。
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import guardWords from '../../../shared/design-guard-words.json'
import { isDesignRequest } from './designGuard'

/** 与 beautify.test.ts 同范式：vitest cwd 为 frontend/，shared 在其上一级 */
const SHARED_WORDS = JSON.parse(
  readFileSync(resolve(process.cwd(), '../shared/design-guard-words.json'), 'utf-8'),
) as { componentWords: string[]; effectWords: string[] }

describe('designGuard（缺陷 9 角色边界）', () => {
  it('设计请求放行（既有口径回归）', () => {
    const allowed = [
      '设计一个登录页',
      '做一个电商优惠券领取页，红色调',
      '把按钮改成红色',
      '将标题居中，圆角再大一点',
      '帮我做个金融数据仪表板',
    ]
    for (const prompt of allowed) expect(isDesignRequest(prompt), prompt).toBe(true)
  })

  it('无关请求拦截', () => {
    const blocked = ['今天天气怎么样', '帮我写首诗', '1+1 等于几', '什么是人工智能']
    for (const prompt of blocked) expect(isDesignRequest(prompt), prompt).toBe(false)
  })

  it('§4.6 正例：组件词+效果词定向识别（裸"加"句式不再误拦）', () => {
    const allowed = [
      '给所有卡片加阴影', // T4 批 3 抽检被误拦的原始表述
      '卡片加个渐变',
      '给标题加描边',
      '给按钮加投影',
    ]
    for (const prompt of allowed) expect(isDesignRequest(prompt), prompt).toBe(true)
  })

  it('§4.6 反例：角色边界不因定向识别而放宽', () => {
    const blocked = [
      '帮我写首诗',
      '今天天气怎么样',
      '帮我加载更多按钮', // 含组件词但无效果词，裸"加"未入动词表
      '更加厉害的人工智能', // 含"更加"但无组件/效果词
    ]
    for (const prompt of blocked) expect(isDesignRequest(prompt), prompt).toBe(false)
  })
})

describe('designGuard 词表单一来源（§4.6 方案 A：shared/design-guard-words.json）', () => {
  it('运行时加载结果 == shared JSON 内容（与 beautify-effects 契约测试同范式）', () => {
    expect(guardWords.componentWords).toEqual(SHARED_WORDS.componentWords)
    expect(guardWords.effectWords).toEqual(SHARED_WORDS.effectWords)
  })

  it('假词生效：给加载结果追加 → 判定跟着变（证明是"读取"而非"抄写"）', () => {
    const componentWords = guardWords.componentWords as string[]
    componentWords.push('测试假组件')
    try {
      expect(isDesignRequest('测试假组件加阴影')).toBe(true)
    } finally {
      componentWords.pop()
    }
    expect(isDesignRequest('测试假组件加阴影')).toBe(false)

    const effectWords = guardWords.effectWords as string[]
    effectWords.push('测试假效果')
    try {
      expect(isDesignRequest('给按钮加测试假效果')).toBe(true)
    } finally {
      effectWords.pop()
    }
    expect(isDesignRequest('给按钮加测试假效果')).toBe(false)
  })
})
