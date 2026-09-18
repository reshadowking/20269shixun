/**
 * API 配置页测试：加载脱敏配置、供应商预设、保存、测试连接。
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import ApiConfigPage from './ApiConfigPage'

const CONFIG = {
  llm_mode: 'real',
  llm_base_url: 'https://api.deepseek.com/v1',
  llm_api_key: 'sk-****1234',
  llm_model: 'deepseek-chat',
  llm_backup_model: 'deepseek-chat',
  llm_timeout_seconds: 60,
  llm_max_tokens: 16384,
  providers: {
    deepseek: { name: 'DeepSeek', base_url: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
    qwen: { name: '通义千问 Qwen', base_url: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus' },
    moonshot: { name: 'Kimi Moonshot', base_url: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k' },
  },
}

function mockFetch() {
  return vi.fn(async (url: string, options?: RequestInit) => {
    const path = String(url)
    // 2026-09-18：档案接口的真实形状是 {active, profiles}。之前这里把 `/api/llm-config/profiles`
    // 也当成单配置返回（没有 profiles 字段），组件拿到 undefined 会整页白屏——旧代码只是被
    // catch 里的 setProfiles([]) 恰好掩盖。mock 必须与真实契约一致，否则这类形状问题测不出来。
    if (path.includes('/api/llm-config/profiles')) {
      if (options?.method === 'POST') {
        return {
          ok: true,
          status: 200,
          json: async () => ({ active: 'p-a', profiles: [{ id: 'p-a', name: 'DeepSeek 官方', llm_api_key: 'sk-****5678' }] }),
        }
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          active: 'p-a',
          profiles: [
            {
              id: 'p-a',
              name: 'DeepSeek 官方',
              llm_base_url: 'https://api.deepseek.com/v1',
              llm_api_key: 'sk-****1234',
              llm_model: 'deepseek-chat',
              llm_backup_model: 'deepseek-chat',
              llm_timeout_seconds: 60,
            },
          ],
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
          ? { ok: true, status: 200, json: async () => ({ ok: false, error: 'HTTP 401 鉴权失败', code: 'APIStatusError' }) }
          : { ok: true, status: 200, json: async () => ({ ok: true, reply: '连接成功', model: 'deepseek-chat' }) }
      }
      return { ok: true, status: 200, json: async () => ({ ...CONFIG, ...body, llm_api_key: 'sk-****5678' }) }
    }
    throw new Error(`unexpected fetch: ${path}`)
  })
}

describe('ApiConfigPage', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = mockFetch()
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('loads current config with masked key', async () => {
    render(<MemoryRouter><ApiConfigPage /></MemoryRouter>)
    await waitFor(() => {
      expect(screen.getByTestId('cfg-base-url')).toHaveValue('https://api.deepseek.com/v1')
    })
    expect(screen.getByTestId('cfg-model')).toHaveValue('deepseek-chat')
    expect(screen.getByTestId('cfg-api-key')).toHaveValue('sk-****1234')
  })

  /**
   * 2026-09-18：档案接口形状不对（缺 `profiles`）时**不许**整页白屏。
   * 旧代码 `setProfiles(data.profiles)` 会把 undefined 塞进 state → `profiles.map` 直接炸，
   * 用户看到的是"API 配置页一片空白"（而且刷新也没用）。现在按空列表渲染。
   */
  it('档案响应缺 profiles 字段：不白屏，页面照常渲染', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const path = String(url)
        if (path.includes('/api/llm-config/profiles')) {
          return { ok: true, status: 200, json: async () => ({ active: 'p-a' }) } // 故意缺 profiles
        }
        return { ok: true, status: 200, json: async () => CONFIG }
      }),
    )
    render(<MemoryRouter><ApiConfigPage /></MemoryRouter>)
    await waitFor(() => {
      expect(screen.getByTestId('cfg-base-url')).toHaveValue('https://api.deepseek.com/v1')
    })
    expect(screen.getByTestId('profile-select')).toBeInTheDocument()
    expect(screen.getByTestId('cfg-save')).toBeInTheDocument()
  })

  it('provider preset fills base url and model', async () => {
    render(<MemoryRouter><ApiConfigPage /></MemoryRouter>)
    fireEvent.click(await screen.findByTestId('provider-qwen'))
    expect(screen.getByTestId('cfg-base-url')).toHaveValue('https://dashscope.aliyuncs.com/compatible-mode/v1')
    expect(screen.getByTestId('cfg-model')).toHaveValue('qwen-plus')
  })

  it('save posts config and shows success', async () => {
    render(<MemoryRouter><ApiConfigPage /></MemoryRouter>)
    fireEvent.change(await screen.findByTestId('cfg-api-key'), { target: { value: 'sk-new-key-999' } })
    fireEvent.click(screen.getByTestId('cfg-save'))
    await waitFor(() => {
      const post = fetchMock.mock.calls.find((c) => String(c[0]).includes('/api/llm-config') && String(c[0]).includes('/test') === false && String(c[1]?.method) === 'POST')
      expect(post).toBeTruthy()
      const body = JSON.parse(String(post![1].body))
      expect(body.llm_api_key).toBe('sk-new-key-999')
      expect(body.llm_model).toBe('deepseek-chat')
    })
    expect(await screen.findByTestId('save-ok')).toBeInTheDocument()
  })

  it('test connection success shows reply', async () => {
    render(<MemoryRouter><ApiConfigPage /></MemoryRouter>)
    fireEvent.click(await screen.findByTestId('cfg-test'))
    expect(await screen.findByTestId('test-result')).toHaveTextContent('连接成功')
  })

  it('test connection failure shows error', async () => {
    render(<MemoryRouter><ApiConfigPage /></MemoryRouter>)
    fireEvent.change(await screen.findByTestId('cfg-api-key'), { target: { value: 'sk-bad-key' } })
    fireEvent.click(screen.getByTestId('cfg-test'))
    expect(await screen.findByTestId('test-result')).toHaveTextContent('连接失败')
  })

  it('保存未编辑过的 key 时不提交 llm_api_key（防脱敏值回写覆盖真实 Key）', async () => {
    render(<MemoryRouter><ApiConfigPage /></MemoryRouter>)
    // 只改 model，不动 key 输入框（回显值为脱敏 sk-****1234）
    fireEvent.change(await screen.findByTestId('cfg-model'), { target: { value: 'qwen-plus' } })
    fireEvent.click(screen.getByTestId('cfg-save'))
    await waitFor(() => {
      const post = fetchMock.mock.calls.find(
        (c) => String(c[0]).includes('/api/llm-config') && String(c[0]).includes('/test') === false && String(c[1]?.method) === 'POST',
      )
      expect(post).toBeTruthy()
      const body = JSON.parse(String(post![1].body))
      expect(body.llm_api_key).toBeUndefined()
      expect(body.llm_model).toBe('qwen-plus')
    })
    expect(await screen.findByTestId('save-ok')).toBeInTheDocument()
  })
})
