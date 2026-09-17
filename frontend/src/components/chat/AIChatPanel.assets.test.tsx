/**
 * 生成时把用户资产库的图片带给模型（2026-09-17）。
 * 验收点：请求体带 assets（名字 + url）；取图失败只是少一个字段，绝不挡住生成。
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { DesignNode } from '@/design/types'

import AIChatPanel from './AIChatPanel'

const DESIGN: DesignNode = {
  id: 'root',
  type: 'frame',
  style: { layout: 'column' },
  children: [{ id: 'title', type: 'text', props: { text: '标题' }, style: {} }],
}

function sessionStub(path: string) {
  if (path.includes('/messages')) return { ok: true, status: 200, json: async () => ({ messages: [], pruned: 0 }) }
  if (path.includes('/tool-calls')) return { ok: true, status: 200, json: async () => ({ ok: true, id: 1 }) }
  return {
    ok: true,
    status: 200,
    json: async () => ({
      session_id: 's-test',
      title: 't',
      design_id: null,
      created_at: null,
      updated_at: null,
      agent_state: {},
    }),
  }
}

function generateStub() {
  return {
    ok: true,
    status: 200,
    json: async () => ({ design: DESIGN, template: 'login', compliance: 100, violations: 0, fallback: false }),
  }
}

function renderPanel() {
  render(
    <AIChatPanel
      sessionKey="s-assets"
      design={DESIGN}
      onGenerate={vi.fn()}
      onIncrementalEdit={vi.fn(() => ({ ok: true }))}
    />,
  )
}

function typeAndSend(text: string) {
  fireEvent.change(screen.getByTestId('chat-input'), { target: { value: text } })
  fireEvent.click(screen.getByTestId('chat-send'))
}

describe('AIChatPanel：生成时注入用户资产库图片', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('有资产时请求体带 assets（name + url）', async () => {
    const fetchMock = vi.fn(async (url: string, _options?: RequestInit) => {
      const path = String(url)
      if (path.includes('/api/images')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            images: [
              { id: 12, filename: '蓝色渐变.png', url: '/api/images/12' },
              { id: 13, filename: '运动鞋主图.png', url: '/api/images/13' },
            ],
          }),
        }
      }
      if (path.includes('/api/generate')) return generateStub()
      if (path.includes('/api/sessions')) return sessionStub(path)
      throw new Error(`unexpected fetch: ${path}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    renderPanel()

    typeAndSend('用我上传的图做个落地页')
    await waitFor(() => {
      const call = fetchMock.mock.calls.find((c) => String(c[0]).includes('/api/generate'))
      expect(call).toBeTruthy()
      const body = JSON.parse(String(call?.[1]?.body))
      expect(body.assets).toEqual([
        { id: 12, name: '蓝色渐变.png', url: '/api/images/12' },
        { id: 13, name: '运动鞋主图.png', url: '/api/images/13' },
      ])
    })
  })

  it('取资产失败：不挡生成，只是不带 assets', async () => {
    const fetchMock = vi.fn(async (url: string, _options?: RequestInit) => {
      const path = String(url)
      if (path.includes('/api/images')) throw new TypeError('network down')
      if (path.includes('/api/generate')) return generateStub()
      if (path.includes('/api/sessions')) return sessionStub(path)
      throw new Error(`unexpected fetch: ${path}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    renderPanel()

    typeAndSend('随便设计一个登录页')
    await waitFor(() => {
      const call = fetchMock.mock.calls.find((c) => String(c[0]).includes('/api/generate'))
      expect(call).toBeTruthy()
      expect(JSON.parse(String(call?.[1]?.body))).not.toHaveProperty('assets')
    })
  })
})
