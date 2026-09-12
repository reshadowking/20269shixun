/**
 * 缺陷 3 契约与纯函数：前端白名单必须与 shared/beautify-effects.json 完全一致（防漂移）。
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  EFFECT_KEYS,
  EFFECT_SPECS,
  SIZE_CHANGING_KEYS,
  collectAppliedEffects,
  collectSameTypeNodes,
  countBeautifiedNodes,
  effectValueLabel,
  findInvalidEffectKeys,
  isWhitelistedEffect,
} from './beautify'
import type { DesignNode } from './types'

/** 与 registry.test.tsx 同范式：vitest cwd 为 frontend/，shared 在其上一级 */
const SHARED = JSON.parse(
  readFileSync(resolve(process.cwd(), '../shared/beautify-effects.json'), 'utf-8'),
) as {
  keys: Array<{ key: string; label: string; changesSize: boolean; values: Array<{ value: string | number; label: string }> }>
}

describe('美化白名单契约（shared/beautify-effects.json）', () => {
  it('key 集合与顺序一致', () => {
    expect(EFFECT_KEYS).toEqual(SHARED.keys.map((k) => k.key))
  })

  it('每个 key 的标签、尺寸标记、预置值集合一致', () => {
    for (const spec of SHARED.keys) {
      const local = EFFECT_SPECS.find((s) => s.key === spec.key)
      expect(local, `前端缺少效果键 ${spec.key}`).toBeDefined()
      expect(local!.label).toBe(spec.label)
      expect(local!.changesSize).toBe(spec.changesSize)
      expect(local!.values.map((v) => v.value)).toEqual(spec.values.map((v) => v.value))
      expect(local!.values.map((v) => v.label)).toEqual(spec.values.map((v) => v.label))
    }
  })

  it('尺寸变更键集合与 shared 标记一致', () => {
    expect(SIZE_CHANGING_KEYS).toEqual(SHARED.keys.filter((k) => k.changesSize).map((k) => k.key))
  })
})

describe('白名单校验', () => {
  it('预置值合法，非预置值/未知键非法', () => {
    expect(isWhitelistedEffect('shadow', '0 4px 12px rgba(29,33,41,0.10)')).toBe(true)
    expect(isWhitelistedEffect('shadow', '0 0 0 red; background: url(http://evil/x.png)')).toBe(false)
    expect(isWhitelistedEffect('backgroundImage', 'url(http://evil/x.png)')).toBe(false)
    expect(isWhitelistedEffect('layout', 'grid')).toBe(false)
    expect(isWhitelistedEffect('shadow', null)).toBe(true) // null = 移除
  })

  it('findInvalidEffectKeys 列出全部违规键（供写入层拒绝）', () => {
    expect(findInvalidEffectKeys({ shadow: '0 4px 12px rgba(29,33,41,0.10)' })).toEqual([])
    expect(findInvalidEffectKeys({ layout: 'grid', props: {}, shadow: 'bogus' }).sort()).toEqual(['layout', 'props', 'shadow'])
  })

  it('effectValueLabel 给出人话标签', () => {
    expect(effectValueLabel('shadow', '0 10px 30px rgba(29,33,41,0.16)')).toBe('中')
    expect(effectValueLabel('radius', 16)).toBe('大圆角')
    expect(effectValueLabel('shadow', '未知值')).toBe('未知值')
  })

  it('collectAppliedEffects / countBeautifiedNodes 统计已应用效果', () => {
    const tree: DesignNode = {
      id: 'root',
      type: 'frame',
      children: [
        { id: 'a', type: 'component', componentType: 'card', style: { shadow: '0 1px 2px rgba(29,33,41,0.06)', width: 320 } },
        { id: 'b', type: 'text', style: { color: 'primary' } },
        { id: 'c', type: 'rect', style: { transform: 'scale(1.04)', radius: 8 } },
      ],
    }
    expect(collectAppliedEffects(tree.children![0])).toEqual([{ key: 'shadow', value: '0 1px 2px rgba(29,33,41,0.06)' }])
    expect(collectAppliedEffects(tree.children![1])).toEqual([])
    expect(countBeautifiedNodes(tree)).toBe(2)
  })
})

describe('collectSameTypeNodes（T4 批3：应用到同类节点）', () => {
  const TREE: DesignNode = {
    id: 'root',
    type: 'frame',
    style: { layout: 'column' },
    children: [
      { id: 'card-1', type: 'component', componentType: 'card', style: {} },
      { id: 'card-2', type: 'component', componentType: 'card', style: {}, hidden: true },
      {
        id: 'row',
        type: 'frame',
        style: { layout: 'row' },
        children: [
          { id: 'card-3', type: 'component', componentType: 'card', style: {} },
          { id: 'btn-1', type: 'component', componentType: 'button', style: {} },
          { id: 't-1', type: 'text', props: { text: 'A' }, style: {} },
          { id: 't-2', type: 'text', props: { text: 'B' }, style: {}, hidden: true },
        ],
      },
    ],
  }

  it('同类 = 同 componentType 的全部可见节点（含选中节点自身，跨层级）', () => {
    const selected = TREE.children![0] as DesignNode
    const ids = collectSameTypeNodes(TREE, selected).map((n) => n.id)
    expect(ids).toEqual(['card-1', 'card-3']) // card-2 隐藏被排除；btn/text 不算同类
  })

  it('text 节点无 componentType：按 type 归类，隐藏排除', () => {
    const selected = { id: 't-1', type: 'text', props: { text: 'A' }, style: {} } as DesignNode
    const ids = collectSameTypeNodes(TREE, selected).map((n) => n.id)
    expect(ids).toEqual(['t-1'])
  })
})
