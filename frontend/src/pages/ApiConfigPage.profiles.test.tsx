/**
 * API 配置页 · 多套命名配置（T34）—— 2026-09-17 补的覆盖。
 *
 * 这套功能是用户点名要的（"自定义应该可以命名，用户可以有很多个接口"），但此前**一条测试都没有**：
 * `ApiConfigPage.test.tsx` 只盖了单配置的加载/预设/保存/测连接。这里补上切换、新建、保存、
 * 激活、删除，以及"脱敏 Key 不许回写覆盖真实 Key"这条保护在**档案路径**上是否同样成立。
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
  providers: { deepseek: { name: 'DeepSeek', base_url: 'https://api.deepseek.com/v1', model: 'deepseek-chat' } },
}

const PROFILE_A = {
  id: 'p-a',
  name: 'DeepSeek 官方',
  llm_base_url: 'https://api.deepseek.com/v1',
  llm_api_key: 'sk-****1111',
  llm_model: 'deepseek-chat',
  llm_backup_model: 'deepseek-chat',
  llm_timeout_seconds: 60,
}
const PROFILE_B = {
  id: 'p-b',
  name: '千问',
  llm_base_url: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  llm_api_key: '',
  llm_model: 'qwen-plus',
  llm_backup_model: '',
  llm_timeout_seconds: 45,
}

function json(body: unknown) {
  return { ok: true, status: 200, json: async () => body }
}

describe('ApiConfigPage · 多套命名配置', () => {
  let posts: Array<Record<string, unknown>>
  let deleted: string[]

  function mockFetch() {
    posts = []
    deleted = []
    return vi.fn(async (url: string, options?: RequestInit) => {
      const path = String(url)
      const method = options?.method ?? 'GET'
      if (path.includes('/api/llm-config/profiles')) {
        if (path.includes('/activate')) return json({ active: 'p-b', profiles: [PROFILE_A, PROFILE_B] })
        if (method === 'DELETE') {
          deleted.push(path)
          return json({ active: 'p-a', profiles: [PROFILE_A] })
        }
        if (method === 'POST') {
          const body = JSON.parse(String(options?.body ?? '{}')) as Record<string, unknown>
          posts.push(body)
          return json({ active: body.id ?? 'p-new', profiles: [PROFILE_A, PROFILE_B] })
        }
        return json({ active: 'p-a', profiles: [PROFILE_A, PROFILE_B] })
      }
      if (path.includes('/api/llm-config')) return json(CONFIG)
      throw new Error(`unexpected fetch: ${method} ${path}`)
    })
  }

  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch())
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  function renderPage() {
    return render(
      <MemoryRouter>
        <ApiConfigPage />
      </MemoryRouter>,
    )
  }

  it('加载档案列表：当前生效的那份被选中', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByTestId('profile-select')).toHaveValue('p-a'))
    expect(screen.getByTestId('profile-name')).toHaveValue('DeepSeek 官方')
  })

  /**
   * 2026-09-18：档案列表加载失败**不许**清成空列表 + 静默——
   * 用户会以为"我的接口配置全没了"，然后重新填一遍 Key（真实配置其实还在服务端）。
   */
  it('档案列表加载失败：给出可读提示，而不是显示成"没有档案"', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).includes('/api/llm-config/profiles')) {
        return { ok: false, status: 503, json: async () => ({ detail: '服务暂时不可用' }) }
      }
      return json(CONFIG)
    }))
    renderPage()
    await waitFor(() => expect(screen.getByTestId('profile-msg')).toHaveTextContent('档案列表加载失败'))
    expect(screen.getByTestId('profile-msg')).toHaveTextContent('服务暂时不可用')
  })

  it('切到另一份档案：表单载入它的地址/模型，Key 不回填（脱敏值不能被当成真实 Key）', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByTestId('profile-select')).toHaveValue('p-a'))

    fireEvent.change(screen.getByTestId('profile-select'), { target: { value: 'p-b' } })

    expect(screen.getByTestId('cfg-base-url')).toHaveValue('https://dashscope.aliyuncs.com/compatible-mode/v1')
    expect(screen.getByTestId('cfg-model')).toHaveValue('qwen-plus')
    expect(screen.getByTestId('cfg-api-key')).toHaveValue('')
    expect(screen.getByTestId('profile-msg')).toHaveTextContent('还没有 Key')
  })

  it('新建：清空表单（不继承上一个档案）→ 保存成新档案（不带 id、带 Key）', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByTestId('profile-select')).toHaveValue('p-a'))

    fireEvent.click(screen.getByTestId('profile-new'))
    // 用户报过的"自定义跟着上一个走"：新建必须清空地址与模型
    expect(screen.getByTestId('cfg-base-url')).toHaveValue('')
    expect(screen.getByTestId('cfg-model')).toHaveValue('')
    expect(screen.getByTestId('cfg-api-key')).toHaveValue('')

    fireEvent.change(screen.getByTestId('profile-name'), { target: { value: '本地 Ollama' } })
    fireEvent.change(screen.getByTestId('cfg-base-url'), { target: { value: 'http://localhost:11434/v1' } })
    fireEvent.change(screen.getByTestId('cfg-model'), { target: { value: 'deepseek-v4-pro' } })
    fireEvent.change(screen.getByTestId('cfg-api-key'), { target: { value: 'sk-ollama' } })
    fireEvent.click(screen.getByTestId('profile-save'))

    await waitFor(() => expect(posts).toHaveLength(1))
    expect(posts[0]).toMatchObject({
      name: '本地 Ollama',
      llm_base_url: 'http://localhost:11434/v1',
      llm_model: 'deepseek-v4-pro',
      llm_api_key: 'sk-ollama',
    })
    expect(posts[0].id, '新建不该带 id（带了就等于覆盖别人）').toBeUndefined()
    expect(await screen.findByTestId('profile-msg')).toHaveTextContent('已保存并设为当前生效')
  })

  it('改了 Key 才提交 llm_api_key；没改（回显脱敏值）时保存不带 Key', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByTestId('profile-select')).toHaveValue('p-a'))

    // 只改模型，不碰 Key 输入框
    fireEvent.change(screen.getByTestId('cfg-model'), { target: { value: 'deepseek-reasoner' } })
    fireEvent.click(screen.getByTestId('profile-save'))

    await waitFor(() => expect(posts).toHaveLength(1))
    expect(posts[0].llm_api_key, '脱敏值绝不能回写覆盖真实 Key').toBeUndefined()
    expect(posts[0]).toMatchObject({ id: 'p-a', llm_model: 'deepseek-reasoner' })
  })

  it('设为生效：POST /profiles/{id}/activate 并给出回执', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByTestId('profile-select')).toHaveValue('p-a'))
    fireEvent.change(screen.getByTestId('profile-select'), { target: { value: 'p-b' } })

    fireEvent.click(screen.getByTestId('profile-activate'))

    expect(await screen.findByTestId('profile-msg')).toHaveTextContent('已切换生效档案')
  })

  it('删除：二次确认后才发 DELETE', async () => {
    const confirmSpy = vi.fn(() => true)
    vi.stubGlobal('confirm', confirmSpy)
    renderPage()
    await waitFor(() => expect(screen.getByTestId('profile-select')).toHaveValue('p-a'))

    fireEvent.click(screen.getByTestId('profile-delete'))

    await waitFor(() => expect(deleted).toHaveLength(1))
    expect(deleted[0]).toContain('/api/llm-config/profiles/p-a')
    expect(confirmSpy).toHaveBeenCalled()
    expect(await screen.findByTestId('profile-msg')).toHaveTextContent('已删除')
  })
})
