/**
 * 登录页的 `?redirect=` 守卫（2026-09-17 由探针转正）。
 *
 * 实测背景：原来只判断 `startsWith('/')`，于是 `//evil.com`（协议相对 URL）与 `/\evil.com`
 * 都能通过 → React Router 抛 `External navigation is not allowed`（浏览器里是 pushState 的
 * SecurityError）→ **登录成功后页面反而报错卡住**。现在非站内路径一律回落首页。
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

import LoginPage from './LoginPage'

afterEach(() => {
  vi.unstubAllGlobals()
  localStorage.clear()
})

function renderLogin(target: string) {
  render(
    <MemoryRouter initialEntries={[`/login?redirect=${encodeURIComponent(target)}`]}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/" element={<div data-testid="route-home">home</div>} />
        <Route path="/projects" element={<div data-testid="route-projects">projects</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

async function login() {
  fireEvent.change(screen.getByTestId('login-password'), { target: { value: 'demo123' } })
  fireEvent.click(screen.getByTestId('login-submit'))
  await waitFor(() => expect(localStorage.getItem('design-tool-token')).toBe('tok'))
}

describe('登录页 redirect 守卫', () => {
  it('站内路径照旧生效（/projects 仍去 /projects）', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ token: 'tok', username: 'demo' }) })))
    renderLogin('/projects')
    await login()
    expect(await screen.findByTestId('route-projects')).toBeInTheDocument()
  })

  it.each(['//evil.com', '/\\evil.com', 'https://evil.com', 'javascript:alert(1)'])(
    '非站内路径 %s → 回落首页（且不抛 External navigation）',
    async (target) => {
      vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ token: 'tok', username: 'demo' }) })))
      renderLogin(target)
      await login()
      expect(await screen.findByTestId('route-home')).toBeInTheDocument()
    },
  )
})
