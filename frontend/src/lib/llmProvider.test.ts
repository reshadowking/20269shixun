/**
 * 供应商预设/API 格式的前端纯函数测试（T48）。
 * 重点：只做展示与即时校验，绝不复制后端的归一化/拼接逻辑。
 */
import { describe, expect, it } from 'vitest'

import {
  anthropicV1Warning,
  formatHint,
  supportedFormats,
  validateBaseUrl,
  visibleProviders,
  type ProviderPreset,
} from './llmProvider'

const SUFFIXES = ['/chat/completions', '/responses', '/messages']
const MESSAGE = 'BaseURL 不应包含路径后缀'

const kimi: ProviderPreset = {
  name: 'Kimi',
  base_url: 'https://api.moonshot.cn/v1',
  model: 'kimi-k2.7-code',
  supported_formats: ['chat', 'responses', 'anthropic'],
  base_url_by_format: {
    chat: 'https://api.moonshot.cn/v1',
    responses: 'https://api.moonshot.cn/v1',
    anthropic: 'https://api.moonshot.cn/anthropic',
  },
  final_url_by_format: { chat: 'https://api.moonshot.cn/v1/chat/completions', anthropic: null },
  hint_by_format: { chat: '当前预设会调用 `https://api.moonshot.cn/v1/chat/completions`。' },
}

describe('visibleProviders', () => {
  it('跳过 deprecated 别名', () => {
    const rows = visibleProviders({
      kimi,
      moonshot: { ...kimi, deprecated: true },
    })
    expect(rows.map(([id]) => id)).toEqual(['kimi'])
  })

  it('providers 缺失时返回空数组（不炸）', () => {
    expect(visibleProviders(undefined)).toEqual([])
  })
})

describe('validateBaseUrl', () => {
  it('命中禁用后缀时给出后端文案与命中项', () => {
    expect(validateBaseUrl('https://api.deepseek.com/chat/completions', SUFFIXES, MESSAGE)).toBe(
      'BaseURL 不应包含路径后缀（检测到 /chat/completions）',
    )
    expect(validateBaseUrl('https://x.com/v1/messages', SUFFIXES, MESSAGE)).toContain('/messages')
  })

  it('放行合法 base（含 /v1、/compatible-mode/v1、/anthropic）', () => {
    expect(validateBaseUrl('https://api.deepseek.com', SUFFIXES, MESSAGE)).toBeNull()
    expect(validateBaseUrl('https://api.deepseek.com/v1', SUFFIXES, MESSAGE)).toBeNull()
    expect(
      validateBaseUrl('https://dashscope.aliyuncs.com/compatible-mode/v1', SUFFIXES, MESSAGE),
    ).toBeNull()
    expect(validateBaseUrl('https://api.moonshot.cn/anthropic', SUFFIXES, MESSAGE)).toBeNull()
  })

  it('空值合法（自定义预设默认空）', () => {
    expect(validateBaseUrl('', SUFFIXES, MESSAGE)).toBeNull()
    expect(validateBaseUrl('   ', SUFFIXES, MESSAGE)).toBeNull()
  })
})

describe('anthropicV1Warning', () => {
  it('anthropic 格式 + base 以 /v1 结尾时提示（非拦截）', () => {
    const warning = anthropicV1Warning('https://example.com/v1/', 'anthropic')
    expect(warning).toContain('/v1/v1/messages')
  })

  it('其他格式或非 /v1 结尾时不提示', () => {
    expect(anthropicV1Warning('https://example.com/v1', 'chat')).toBeNull()
    expect(anthropicV1Warning('https://api.moonshot.cn/anthropic', 'anthropic')).toBeNull()
    expect(anthropicV1Warning('', 'anthropic')).toBeNull()
  })
})

describe('formatHint / supportedFormats', () => {
  it('取后端下发的提示串', () => {
    expect(formatHint(kimi, 'chat')).toContain('当前预设会调用')
    expect(formatHint(kimi, 'responses')).toBe('')
    expect(formatHint(undefined, 'chat')).toBe('')
  })

  it('预设缺 supported_formats 时按 chat 兜底', () => {
    expect(supportedFormats({ name: 'x', base_url: '', model: '' })).toEqual(['chat'])
    expect(supportedFormats(kimi)).toEqual(['chat', 'responses', 'anthropic'])
  })
})
