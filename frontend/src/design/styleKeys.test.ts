/**
 * style 键清单的**契约测试**与别名归一的**值语义证明**（T49 / C2）。
 *
 * 两件事：
 * ① 前端镜像必须与 `shared/style-keys.json` 逐项一致（否则"唯一事实源"名不副实）；
 * ② 声明为可渲染的键必须**真的产出 CSS** —— 防"JSON 里登记了、渲染层没实现"。
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { styleToCss } from './styleToCss'
import { STYLE_KEYS, isRenderableStyleKey, normalizeStyleKey, normalizeStyleKeys, styleKeyLabel } from './styleKeys'

/** 事实源（与 styleKeys.ts 的 import 同一份文件；这里用 fs 读是为了断言"文件本身"的内容） */
const shared = JSON.parse(
  readFileSync(resolve(process.cwd(), '../shared/style-keys.json'), 'utf-8'),
) as { renderable: string[]; aliases: Record<string, string>; labels: Record<string, string> }

describe('事实源自洽（shared/style-keys.json）', () => {
  it('别名必须指向**可渲染**的规范键（指向别处等于"归一了也渲染不出来"）', () => {
    const renderable = new Set(shared.renderable)
    const bogus = Object.entries(shared.aliases).filter(([, target]) => !renderable.has(target))
    expect(bogus, `这些别名指向不可渲染键：${JSON.stringify(bogus)}`).toEqual([])
  })

  it('别名不得把规范键改写成自己（恒等映射会掩盖拼写错误）', () => {
    expect(Object.entries(shared.aliases).filter(([from, to]) => from === to)).toEqual([])
  })

  it('每个可渲染键都有中文名', () => {
    const missing = shared.renderable.filter((key) => !shared.labels[key])
    expect(missing, `可渲染键缺中文名：${missing}`).toEqual([])
  })

  it('运行时读到的就是这份文件（import 与 fs 一致）', () => {
    expect([...STYLE_KEYS.renderable].sort()).toEqual([...shared.renderable].sort())
    expect(STYLE_KEYS.aliases).toEqual(shared.aliases)
    expect(STYLE_KEYS.labels).toEqual(shared.labels)
  })
})

/**
 * 每个可渲染键的**样例 style 片段**（含该键 + 必要前置条件）。
 * 例：`gap` 单独写本来就不生效（styleToCss 只在 layout 为 row/column/grid 时输出），
 * 所以它的片段带上 `layout`。片段必须包含该键自身的"能成立"前提，否则测出来的是假失败。
 */
const SAMPLE: Record<string, Record<string, unknown>> = {
  layout: { layout: 'row' },
  gap: { layout: 'row', gap: 8 },
  color: { color: '#333333' },
  background: { background: '#FFFFFF' },
  radius: { radius: 8 },
  width: { width: 100 },
  height: { height: 40 },
  spacing: { spacing: 8 },
  padding: { padding: 12 },
  backgroundImage: { backgroundImage: 'linear-gradient(90deg, #000000 0%, #FFFFFF 100%)' },
  animation: { animation: 'fade-in' },
  shadow: { shadow: '0 1px 2px rgba(0,0,0,0.1)' },
  transform: { transform: 'scale(1.04)' },
  justify: { justify: 'center' },
  alignItems: { alignItems: 'center' },
  align: { align: 'center' },
  fontWeight: { fontWeight: 600 },
  fontSize: { fontSize: 14 },
  flex: { flex: '1' },
  border: { border: '1px solid #E5E7EB' },
  textDecoration: { textDecoration: 'underline' },
  backdropFilter: { backdropFilter: 'blur(14px)' },
  filter: { filter: 'blur(6px)' },
  opacity: { opacity: 0.72 },
}

/** 该键应当产出的 CSS 属性名（键与属性名不同名，必须显式给出） */
const EXPECTED_CSS: Record<string, string> = {
  layout: 'display',
  gap: 'gap',
  color: 'color',
  background: 'background',
  radius: 'borderRadius',
  width: 'width',
  height: 'height',
  spacing: 'padding',
  padding: 'padding',
  backgroundImage: 'backgroundImage',
  animation: 'animation',
  shadow: 'boxShadow',
  transform: 'transform',
  justify: 'justifyContent',
  alignItems: 'alignItems',
  align: 'textAlign',
  fontWeight: 'fontWeight',
  fontSize: 'fontSize',
  flex: 'flex',
  border: 'border',
  textDecoration: 'textDecoration',
  backdropFilter: 'backdropFilter',
  filter: 'filter',
  opacity: 'opacity',
}

describe('可渲染键：登记了就必须真的产出对应 CSS', () => {
  it('每个可渲染键都有样例片段与期望属性（新增键必须补齐，别漏测）', () => {
    const missingSample = STYLE_KEYS.renderable.filter((key) => !SAMPLE[key])
    expect(missingSample, `这些可渲染键缺样例片段：${missingSample}`).toEqual([])
    const missingExpect = STYLE_KEYS.renderable.filter((key) => !EXPECTED_CSS[key])
    expect(missingExpect, `这些可渲染键缺期望属性：${missingExpect}`).toEqual([])
  })

  it('期望表里没有多余的键（清单改了要同步删）', () => {
    const renderable = new Set(STYLE_KEYS.renderable)
    const extra = Object.keys(EXPECTED_CSS).filter((key) => !renderable.has(key))
    expect(extra, `期望表里有已不在清单里的键：${extra}`).toEqual([])
  })

  for (const key of STYLE_KEYS.renderable) {
    it(`${key} → 产出 ${EXPECTED_CSS[key]}`, () => {
      const css = styleToCss(SAMPLE[key]) as Record<string, unknown>
      expect(css[EXPECTED_CSS[key]], `${key} 没有产出 ${EXPECTED_CSS[key]}`).toBeDefined()
    })
  }
})

describe('别名归一：存量树的近义键必须真渲染（值语义一并验证）', () => {
  it('boxShadow（CSS 字符串）→ boxShadow 原样透传', () => {
    const css = styleToCss({ boxShadow: '0 4px 12px rgba(29,33,41,0.10)' })
    expect(css.boxShadow).toBe('0 4px 12px rgba(29,33,41,0.10)')
  })

  it('borderRadius：数字与字符串两种写法都保留', () => {
    expect(styleToCss({ borderRadius: 8 }).borderRadius).toBe(8)
    expect(styleToCss({ borderRadius: '8px' }).borderRadius).toBe('8px')
  })

  it('backgroundColor：色值透传、令牌名解析成色值', () => {
    expect(styleToCss({ backgroundColor: '#FFFFFF' }).background).toBe('#FFFFFF')
    const token = styleToCss({ backgroundColor: 'primary' }).background as string
    expect(token).toMatch(/^#|rgb/)
  })

  it('连字符写法（box-shadow / border-radius）也归一', () => {
    expect(styleToCss({ 'box-shadow': '0 1px 2px rgba(0,0,0,.2)' }).boxShadow).toBe(
      '0 1px 2px rgba(0,0,0,.2)',
    )
    expect(styleToCss({ 'border-radius': 12 }).borderRadius).toBe(12)
  })

  it('**规范键优先**：同时给出 radius 与 borderRadius 时以 radius 为准（行为确定）', () => {
    expect(styleToCss({ radius: 4, borderRadius: 12 }).borderRadius).toBe(4)
    expect(normalizeStyleKeys({ radius: 4, borderRadius: 12 }).borderRadius).toBeUndefined()
  })

  it('不可渲染的键原样保留在数据里，但渲染层不产出 CSS（由变更清单如实标注）', () => {
    const css = styleToCss({ boxSizing: 'border-box', letterSpacing: '0.5px' })
    expect(css).toEqual({})
    expect(isRenderableStyleKey('boxSizing')).toBe(false)
    expect(isRenderableStyleKey('boxShadow')).toBe(true)
  })
})

describe('玻璃与质感（C5）的渲染支持', () => {
  it('backdropFilter 同时产出标准与前缀属性（Safari）', () => {
    const css = styleToCss({ backdropFilter: 'blur(14px)' }) as Record<string, unknown>
    expect(css.backdropFilter).toBe('blur(14px)')
    expect(css.WebkitBackdropFilter).toBe('blur(14px)')
  })

  it('函数型值做注入校验：含分号/花括号的写法一律丢弃', () => {
    expect(styleToCss({ backdropFilter: 'blur(14px); color: red' })).toEqual({})
    expect(styleToCss({ filter: 'blur(6px); }' })).toEqual({})
    expect(styleToCss({ transform: 'scale(1.04)' }).transform).toBe('scale(1.04)')
  })

  it('opacity 数值透传', () => {
    expect(styleToCss({ opacity: 0.72 }).opacity).toBe(0.72)
  })
})

describe('字段中文名（变更清单用）', () => {
  it('别名先归一再看标签', () => {
    expect(styleKeyLabel('boxShadow')).toBe('阴影（CSS 字符串）')
    expect(normalizeStyleKey('bgColor')).toBe('background')
  })

  it('未登记的键回落到键名本身（不返回 undefined）', () => {
    expect(styleKeyLabel('somethingWeird')).toBe('somethingWeird')
  })
})
