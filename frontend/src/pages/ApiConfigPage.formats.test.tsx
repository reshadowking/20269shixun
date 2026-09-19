/**
 * T48：供应商预设与 API 格式的面板行为测试。
 *
 * 覆盖：预设↔格式联动、不支持的格式置灰、BaseURL 后缀拦截、自定义提示、
 * /v1 提示、失败排查信息（状态码 + 原始 body + 最终 URL + 实际格式）、提交字段。
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import ApiConfigPage from './ApiConfigPage'

/** 与后端 /api/llm-config 的真实形状保持一致（含 T48 新字段） */
const CONFIG = {
  llm_mode: 'real',
  llm_base_url: 'https://api.deepseek.com',
  llm_api_key: 'sk-****1234',
  llm_model: 'deepseek-flash',
  llm_backup_model: 'deepseek-v4-pro',
  llm_timeout_seconds: 60,
  llm_max_tokens: 16384,
  llm_provider: 'deepseek',
  llm_api_format: 'chat',
  reserved_path_suffixes: ['/chat/completions', '/responses', '/messages'],
  reserved_path_message: 'BaseURL 不应包含路径后缀',
  api_format_labels: {
    chat: 'Chat Completions',
    responses: 'OpenAI Responses',
    anthropic: 'Anthropic Messages',
  },
  providers: {
    deepseek: {
      name: 'DeepSeek',
      base_url: 'https://api.deepseek.com',
      model: 'deepseek-flash',
      default_api_format: 'chat',
      supported_formats: ['chat', 'responses', 'anthropic'],
      base_url_by_format: {
        chat: 'https://api.deepseek.com',
        responses: 'https://api.deepseek.com',
        anthropic: 'https://api.deepseek.com/anthropic',
      },
      final_url_by_format: {
        chat: 'https://api.deepseek.com/chat/completions',
        responses: 'https://api.deepseek.com/responses',
        anthropic: 'https://api.deepseek.com/anthropic/v1/messages',
      },
      hint_by_format: {
        chat: '当前预设会调用 `https://api.deepseek.com/chat/completions`。若你修改了 BaseURL，以测试连接返回的最终 URL 为准。',
        responses: '当前预设会调用 `https://api.deepseek.com/responses`。若你修改了 BaseURL，以测试连接返回的最终 URL 为准。',
        anthropic: '当前预设会调用 `https://api.deepseek.com/anthropic/v1/messages`。若你修改了 BaseURL，以测试连接返回的最终 URL 为准。',
      },
      models: { primary: 'deepseek-flash', fallback: 'deepseek-v4-pro', flagship: '' },
    },
    kimi: {
      name: 'Kimi',
      base_url: 'https://api.moonshot.cn/v1',
      model: 'kimi-k2.7-code',
      default_api_format: 'chat',
      supported_formats: ['chat', 'responses', 'anthropic'],
      base_url_by_format: {
        chat: 'https://api.moonshot.cn/v1',
        responses: 'https://api.moonshot.cn/v1',
        anthropic: 'https://api.moonshot.cn/anthropic',
      },
      final_url_by_format: {
        chat: 'https://api.moonshot.cn/v1/chat/completions',
        responses: 'https://api.moonshot.cn/v1/responses',
        anthropic: 'https://api.moonshot.cn/anthropic/v1/messages',
      },
      hint_by_format: {
        chat: '当前预设会调用 `https://api.moonshot.cn/v1/chat/completions`。若你修改了 BaseURL，以测试连接返回的最终 URL 为准。',
        responses: '当前预设会调用 `https://api.moonshot.cn/v1/responses`。若你修改了 BaseURL，以测试连接返回的最终 URL 为准。',
        anthropic: '当前预设会调用 `https://api.moonshot.cn/anthropic/v1/messages`。若你修改了 BaseURL，以测试连接返回的最终 URL 为准。',
      },
      models: { primary: 'kimi-k2.7-code', fallback: 'kimi-k2.6', flagship: 'kimi-k3' },
    },
    qwen: {
      name: '通义千问 Qwen',
      base_url: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      model: 'qwen3-coder-plus',
      default_api_format: 'chat',
      supported_formats: ['chat'],
      base_url_by_format: { chat: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
      final_url_by_format: {
        chat: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
      },
      hint_by_format: {
        chat: '当前预设会调用 `https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions`。',
      },
      models: { primary: 'qwen3-coder-plus', fallback: 'qwen3-vl-plus', flagship: '' },
    },
    custom: {
      name: '自定义',
      base_url: '',
      model: '',
      default_api_format: 'chat',
      supported_formats: ['chat', 'responses', 'anthropic'],
      base_url_by_format: { chat: '', responses: '', anthropic: '' },
      final_url_by_format: { chat: null, responses: null, anthropic: null },
      hint_by_format: {
        chat: '自定义预设没有默认 URL，请填写 BaseURL 并以测试连接返回的最终 URL 为准。',
        responses: '自定义预设没有默认 URL，请填写 BaseURL 并以测试连接返回的最终 URL 为准。',
        anthropic: '自定义预设没有默认 URL，请填写 BaseURL 并以测试连接返回的最终 URL 为准。',
      },
      models: { primary: '', fallback: '', flagship: '' },
    },
    /** 旧键别名：只为老 bundle 保留，不应渲染成按钮 */
    moonshot: { name: 'Kimi Moonshot', base_url: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k', deprecated: true },
  },
}

const FAILURE = {
  ok: false,
  error: 'HTTP 401 Authentication Fails',
  code: 'APIStatusError',
  status: 401,
  body: '{"error":{"message":"Authentication Fails, Your api key: ****rmat is invalid"}}',
  final_url: 'https://api.moonshot.cn/anthropic/v1/messages',
  api_format: 'anthropic',
}

function mockFetch() {
  return vi.fn(async (url: string, options?: RequestInit) => {
    const path = String(url)
    if (path.includes('/api/llm-config/profiles')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          active: 'p-a',
          profiles: [{ id: 'p-a', name: 'DeepSeek 官方', llm_base_url: 'https://api.deepseek.com', llm_api_key: 'sk-****1234' }],
        }),
      }
    }
    if (path.includes('/api/llm-config') && !options?.method) {
      return { ok: true, status: 200, json: async () => CONFIG }
    }
    if (path.includes('/api/llm-config') && options?.method === 'POST') {
      const body = JSON.parse(String(options.body))
      if (path.includes('/test')) {
        return body.llm_api_key?.includes('bad')
          ? { ok: true, status: 200, json: async () => FAILURE }
          : { ok: true, status: 200, json: async () => ({ ok: true, reply: '连接成功', model: 'kimi-k2.7-code', api_format: 'chat', latency_ms: 123 }) }
      }
      return { ok: true, status: 200, json: async () => ({ ...CONFIG, ...body, llm_api_key: 'sk-****5678' }) }
    }
    throw new Error(`unexpected fetch: ${path}`)
  })
}

async function renderPage() {
  render(
    <MemoryRouter>
      <ApiConfigPage />
    </MemoryRouter>,
  )
  await screen.findByTestId('cfg-base-url')
}

const formatSelect = () => screen.getByTestId('api-format-select') as HTMLSelectElement
const optionOf = (value: string) => Array.from(formatSelect().options).find((o) => o.value === value)!

describe('供应商预设 × API 格式', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = mockFetch()
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('加载时回显已保存的预设与格式', async () => {
    await renderPage()
    expect(formatSelect()).toHaveValue('chat')
    expect(screen.getByTestId('provider-deepseek').className).toContain('border-primary')
  })

  it('切换预设自动填充 BaseURL + 默认格式 + 推荐模型', async () => {
    await renderPage()
    fireEvent.click(screen.getByTestId('provider-kimi'))
    expect(screen.getByTestId('cfg-base-url')).toHaveValue('https://api.moonshot.cn/v1')
    expect(formatSelect()).toHaveValue('chat')
    expect(screen.getByTestId('cfg-model')).toHaveValue('kimi-k2.7-code')
    expect(screen.getByTestId('cfg-backup-model')).toHaveValue('kimi-k2.6')
  })

  it('切换 API 格式时 BaseURL 联动到该格式的地址', async () => {
    await renderPage()
    fireEvent.click(screen.getByTestId('provider-kimi'))
    fireEvent.change(formatSelect(), { target: { value: 'anthropic' } })
    expect(screen.getByTestId('cfg-base-url')).toHaveValue('https://api.moonshot.cn/anthropic')
    expect(screen.getByTestId('api-format-hint')).toHaveTextContent('moonshot.cn/anthropic/v1/messages')
  })

  it('不支持的格式在下拉里置灰（Qwen 只支持 chat）', async () => {
    await renderPage()
    fireEvent.click(screen.getByTestId('provider-qwen'))
    expect(optionOf('chat').disabled).toBe(false)
    expect(optionOf('responses').disabled).toBe(true)
    expect(optionOf('anthropic').disabled).toBe(true)
  })

  it('deprecated 的旧键别名不渲染成预设按钮', async () => {
    await renderPage()
    expect(screen.queryByTestId('provider-moonshot')).toBeNull()
  })

  it('自定义预设展示无默认 URL 的提示', async () => {
    await renderPage()
    fireEvent.click(screen.getByTestId('provider-custom'))
    expect(screen.getByTestId('api-format-hint')).toHaveTextContent('自定义预设没有默认 URL')
  })
})

describe('BaseURL 校验', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch())
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('带路径后缀时拦截：提示 + 禁用保存/测试', async () => {
    await renderPage()
    fireEvent.change(screen.getByTestId('cfg-base-url'), {
      target: { value: 'https://api.deepseek.com/chat/completions' },
    })
    expect(await screen.findByTestId('cfg-base-url-error')).toHaveTextContent(
      'BaseURL 不应包含路径后缀（检测到 /chat/completions）',
    )
    expect(screen.getByTestId('cfg-save')).toBeDisabled()
    expect(screen.getByTestId('cfg-test')).toBeDisabled()
  })

  it('放行 /v1、/anthropic 这类合法地址', async () => {
    await renderPage()
    fireEvent.change(screen.getByTestId('cfg-base-url'), { target: { value: 'https://api.deepseek.com/v1' } })
    expect(screen.queryByTestId('cfg-base-url-error')).toBeNull()
    expect(screen.getByTestId('cfg-save')).not.toBeDisabled()
  })

  it('anthropic 格式 + 末尾 /v1：只警告不拦截', async () => {
    await renderPage()
    // 先切格式再填地址：切格式会按预设联动 BaseURL，顺序反了会被联动覆盖（这是设计行为）
    fireEvent.change(formatSelect(), { target: { value: 'anthropic' } })
    fireEvent.change(screen.getByTestId('cfg-base-url'), { target: { value: 'https://example.com/v1' } })
    expect(await screen.findByTestId('cfg-base-url-warning')).toHaveTextContent('/v1/v1/messages')
    expect(screen.queryByTestId('cfg-base-url-error')).toBeNull()
    expect(screen.getByTestId('cfg-save')).not.toBeDisabled()
  })
})

/** 老档案：T48 之前保存的，**没有 llm_provider / llm_api_format 字段**，地址是 Kimi 的 */
function legacyProfileFetch() {
  return vi.fn(async (url: string, options?: RequestInit) => {
    const path = String(url)
    if (path.includes('/api/llm-config/profiles')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          active: 'p-a',
          profiles: [
            { id: 'p-a', name: '当前的（DeepSeek）', llm_base_url: 'https://api.deepseek.com', llm_model: 'deepseek-flash' },
            { id: 'p-legacy', name: 'Kimi 老档案', llm_base_url: 'https://api.moonshot.cn/v1', llm_model: 'kimi-k2.7-code' },
          ],
        }),
      }
    }
    if (path.includes('/api/llm-config') && !options?.method) {
      return { ok: true, status: 200, json: async () => CONFIG }
    }
    throw new Error(`unexpected fetch: ${path}`)
  })
}

/** 面板一致性：供应商与地址不许错配；改动未保存必须说出来 */
describe('表单一致性（T48 补强）', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('老档案载入后按地址反推供应商，不沿用上一个值', async () => {
    vi.stubGlobal('fetch', legacyProfileFetch())
    await renderPage()
    expect(screen.getByTestId('provider-deepseek').className).toContain('border-primary')

    fireEvent.change(screen.getByTestId('profile-select'), { target: { value: 'p-legacy' } })

    expect(screen.getByTestId('cfg-base-url')).toHaveValue('https://api.moonshot.cn/v1')
    expect(screen.getByTestId('provider-kimi').className).toContain('border-primary')
    expect(screen.getByTestId('provider-deepseek').className).not.toContain('border-primary')
  })

  it('新建配置时供应商一并重置为自定义（清空地址却留着旧供应商会写出错配）', async () => {
    vi.stubGlobal('fetch', mockFetch())
    await renderPage()
    expect(screen.getByTestId('provider-deepseek').className).toContain('border-primary')

    fireEvent.click(screen.getByTestId('profile-new'))

    expect(screen.getByTestId('cfg-base-url')).toHaveValue('')
    expect(screen.getByTestId('provider-custom').className).toContain('border-primary')
    expect(screen.getByTestId('provider-deepseek').className).not.toContain('border-primary')
  })

  it('改了字段但没保存会明确提示，保存后消失', async () => {
    vi.stubGlobal('fetch', mockFetch())
    await renderPage()
    expect(screen.queryByTestId('cfg-dirty')).toBeNull() // 刚载入：与服务端一致

    fireEvent.change(screen.getByTestId('cfg-model'), { target: { value: 'deepseek-v4-pro' } })
    expect(await screen.findByTestId('cfg-dirty')).toHaveTextContent('有未保存改动')

    fireEvent.click(screen.getByTestId('cfg-save'))
    await waitFor(() => expect(screen.queryByTestId('cfg-dirty')).toBeNull())
  })

  it('点预设按钮同样算未保存改动（本次误判的直接来源）', async () => {
    vi.stubGlobal('fetch', mockFetch())
    await renderPage()
    fireEvent.click(screen.getByTestId('provider-kimi'))
    expect(await screen.findByTestId('cfg-dirty')).toHaveTextContent('有未保存改动')
  })

  it('BaseURL 与所选预设不匹配时提示，但仍允许保存', async () => {
    vi.stubGlobal('fetch', mockFetch())
    await renderPage()
    fireEvent.click(screen.getByTestId('provider-kimi'))
    fireEvent.change(screen.getByTestId('cfg-base-url'), { target: { value: 'https://example.com/v1' } })

    const hint = await screen.findByTestId('cfg-base-url-mismatch')
    expect(hint).toHaveTextContent('不属于预设「Kimi」')
    expect(screen.getByTestId('cfg-save')).not.toBeDisabled()
  })
})

describe('测试连接与保存', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = mockFetch()
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('成功时显示格式与耗时', async () => {
    await renderPage()
    fireEvent.click(screen.getByTestId('cfg-test'))
    const card = await screen.findByTestId('test-result')
    expect(card).toHaveTextContent('连接成功')
    expect(card).toHaveTextContent('耗时 123ms')
  })

  it('失败时显示 HTTP 状态码 / 原始 error body / 最终 URL / 实际格式', async () => {
    await renderPage()
    fireEvent.change(screen.getByTestId('cfg-api-key'), { target: { value: 'sk-bad-key' } })
    fireEvent.click(screen.getByTestId('cfg-test'))
    const card = await screen.findByTestId('test-result')
    expect(card).toHaveTextContent('HTTP 401')
    expect(card).toHaveTextContent('API 格式：anthropic')
    expect(screen.getByTestId('test-final-url')).toHaveTextContent(
      'https://api.moonshot.cn/anthropic/v1/messages',
    )
    expect(screen.getByTestId('test-error-body')).toHaveTextContent('Authentication Fails')
  })

  it('保存时提交 llm_provider 与 llm_api_format', async () => {
    await renderPage()
    fireEvent.click(screen.getByTestId('provider-kimi'))
    fireEvent.change(formatSelect(), { target: { value: 'anthropic' } })
    fireEvent.click(screen.getByTestId('cfg-save'))
    await waitFor(() => {
      const post = fetchMock.mock.calls.find(
        (c) => String(c[0]).includes('/api/llm-config') && !String(c[0]).includes('/test') && String(c[1]?.method) === 'POST',
      )
      expect(post).toBeTruthy()
      const body = JSON.parse(String(post![1].body))
      expect(body.llm_provider).toBe('kimi')
      expect(body.llm_api_format).toBe('anthropic')
      expect(body.llm_base_url).toBe('https://api.moonshot.cn/anthropic')
    })
  })
})
