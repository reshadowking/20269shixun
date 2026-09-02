/**
 * 追问模式工具测试（Q1 模式持久化 / Q3 快捷指令 / 答案合并）。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  detectQuickCommands,
  getFollowupMode,
  mergeAnswers,
  setFollowupMode,
  stripCommandWords,
} from './followup'

describe('FollowupMode storage (Q1)', () => {
  beforeEach(() => localStorage.clear())
  afterEach(() => localStorage.clear())

  it('defaults to smart', () => {
    expect(getFollowupMode()).toBe('smart')
  })

  it('persists and restores each mode', () => {
    for (const mode of ['concise', 'detailed', 'off'] as const) {
      setFollowupMode(mode)
      expect(getFollowupMode()).toBe(mode)
    }
    setFollowupMode('smart')
    expect(getFollowupMode()).toBe('smart')
  })

  it('falls back to smart for unknown values', () => {
    localStorage.setItem('design-followup-mode', 'turbo')
    expect(getFollowupMode()).toBe('smart')
  })
})

describe('Quick commands (Q3)', () => {
  it('skip commands disable followup', () => {
    expect(detectQuickCommands('直接生成一个登录页')).toEqual({ skipFollowup: true })
    expect(detectQuickCommands('不用问，做个页面')).toEqual({ skipFollowup: true })
    expect(detectQuickCommands('不用追问了')).toEqual({ skipFollowup: true })
  })

  it('"问详细一点" switches this turn to detailed', () => {
    expect(detectQuickCommands('问详细一点，设计一个登录页')).toEqual({ modeOverride: 'detailed' })
    expect(detectQuickCommands('详细点')).toEqual({ modeOverride: 'detailed' })
  })

  it('"简单点" switches this turn to concise', () => {
    expect(detectQuickCommands('简单点，做个登录页')).toEqual({ modeOverride: 'concise' })
  })

  it('skip takes priority over mode switches', () => {
    expect(detectQuickCommands('直接生成，不用问详细')).toEqual({ skipFollowup: true })
  })

  it('no command returns empty behavior', () => {
    expect(detectQuickCommands('设计一个登录页')).toEqual({})
  })

  it('strips command words from prompt', () => {
    expect(stripCommandWords('直接生成一个登录页')).toBe('一个登录页')
    expect(stripCommandWords('问详细一点，设计一个 登录页')).toBe('设计一个 登录页')
    expect(stripCommandWords('简单点做个页面')).toBe('做个页面')
    expect(stripCommandWords('设计一个登录页')).toBe('设计一个登录页')
  })
})

describe('mergeAnswers', () => {
  it('appends answers as supplement', () => {
    expect(mergeAnswers('做一个页面', { page_type: '登录页' })).toBe('做一个页面（补充：页面类型：登录页）')
    expect(mergeAnswers('设计一个页面', { page_type: '电商页', style: '简洁现代' })).toBe(
      '设计一个页面（补充：页面类型：电商页；风格：简洁现代）',
    )
  })

  it('returns prompt unchanged when no answers', () => {
    expect(mergeAnswers('做一个页面', {})).toBe('做一个页面')
  })
})
