/**
 * T46a-4：注册页 / 接受邀请页。
 *
 * 这两页是权限模型的地基——没有第二个账号，就验证不了邀请、成员、viewer 只读。
 */
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

import JoinPage from './JoinPage'
import LoginPage from './LoginPage'
import RegisterPage from './RegisterPage'

function renderRegister(fetchMock: unknown, entry = '/register') {
  vi.stubGlobal('fetch', fetchMock)
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/" element={<div data-testid="home-stub">首页</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

function okJson(body: unknown) {
  return { ok: true, status: 200, json: async () => body }
}

describe('T46a-4：注册页', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    localStorage.clear()
  })

  it('注册成功：写入 token 并跳首页', async () => {
    const fetchMock = vi.fn(async (_url: string, _options?: RequestInit) => okJson({ token: 'tk-new', username: 'alice' }))
    renderRegister(fetchMock)

    fireEvent.change(screen.getByTestId('register-username'), { target: { value: 'alice' } })
    fireEvent.change(screen.getByTestId('register-password'), { target: { value: 'alice123' } })
    fireEvent.change(screen.getByTestId('register-confirm'), { target: { value: 'alice123' } })
    fireEvent.click(screen.getByTestId('register-submit'))

    expect(await screen.findByTestId('home-stub')).toBeInTheDocument()
    expect(localStorage.getItem('design-tool-token')).toBe('tk-new')
    expect(String(fetchMock.mock.calls[0][0])).toContain('/api/auth/register')
  })

  it('两次密码不一致：本地拦下，不打接口', () => {
    const fetchMock = vi.fn(async (_url: string, _options?: RequestInit) => okJson({}))
    renderRegister(fetchMock)

    fireEvent.change(screen.getByTestId('register-username'), { target: { value: 'alice' } })
    fireEvent.change(screen.getByTestId('register-password'), { target: { value: 'alice123' } })
    fireEvent.change(screen.getByTestId('register-confirm'), { target: { value: 'alice124' } })
    fireEvent.click(screen.getByTestId('register-submit'))

    expect(screen.getByTestId('register-error')).toHaveTextContent('两次输入的密码不一致')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('密码太短：本地拦下并说清要求（不打接口，也不再甩后端校验 JSON）', () => {
    const fetchMock = vi.fn(async (_url: string, _options?: RequestInit) => okJson({}))
    renderRegister(fetchMock)

    fireEvent.change(screen.getByTestId('register-username'), { target: { value: 'alice' } })
    fireEvent.change(screen.getByTestId('register-password'), { target: { value: '111' } })
    fireEvent.change(screen.getByTestId('register-confirm'), { target: { value: '111' } })
    fireEvent.click(screen.getByTestId('register-submit'))

    expect(screen.getByTestId('register-error')).toHaveTextContent('密码至少 6 位')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('后端校验失败时显示人话（不再是原始 JSON 数组）', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 422,
        json: async () => ({
          detail: [
            { type: 'string_too_short', loc: ['body', 'password'], msg: 'String should have at least 6 characters', ctx: { min_length: 6 } },
          ],
        }),
      })),
    )
    render(
      <MemoryRouter initialEntries={['/register']}>
        <Routes>
          <Route path="/register" element={<RegisterPage />} />
        </Routes>
      </MemoryRouter>,
    )

    fireEvent.change(screen.getByTestId('register-username'), { target: { value: 'alice' } })
    fireEvent.change(screen.getByTestId('register-password'), { target: { value: 'alice123' } })
    fireEvent.change(screen.getByTestId('register-confirm'), { target: { value: 'alice123' } })
    fireEvent.click(screen.getByTestId('register-submit'))

    const error = await screen.findByTestId('register-error')
    expect(error).toHaveTextContent('密码：至少需要 6 个字符')
    expect(error.textContent).not.toContain('string_too_short')
  })

  it('用户名被占用：把后端原因显示出来（不吞错）', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 409, json: async () => ({ detail: '用户名已被占用' }) })),
    )
    render(
      <MemoryRouter initialEntries={['/register']}>
        <Routes>
          <Route path="/register" element={<RegisterPage />} />
        </Routes>
      </MemoryRouter>,
    )

    fireEvent.change(screen.getByTestId('register-username'), { target: { value: 'demo' } })
    fireEvent.change(screen.getByTestId('register-password'), { target: { value: 'demo12345' } })
    fireEvent.change(screen.getByTestId('register-confirm'), { target: { value: 'demo12345' } })
    fireEvent.click(screen.getByTestId('register-submit'))

    expect(await screen.findByTestId('register-error')).toHaveTextContent('用户名已被占用')
  })
})

describe('T46a-4：接受邀请页', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    localStorage.clear()
  })

  function renderJoin(entry: string) {
    return render(
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route path="/join" element={<JoinPage />} />
          <Route path="/projects" element={<div data-testid="projects-stub">项目</div>} />
        </Routes>
      </MemoryRouter>,
    )
  }

  it('加入成功：显示工作区名与我的角色', async () => {
    const fetchMock = vi.fn(async (_url: string, _options?: RequestInit) =>
      okJson({ workspace_id: 3, name: '小张的工作区', role: 'viewer' }),
    )
    vi.stubGlobal('fetch', fetchMock)
    renderJoin('/join?token=tok-abc12345678')

    expect(await screen.findByTestId('join-result')).toHaveTextContent('小张的工作区')
    expect(screen.getByTestId('join-result')).toHaveTextContent('只读访客')
    expect(String(fetchMock.mock.calls[0][0])).toContain('/api/workspaces/join')
  })

  it('邀请无效/用过/过期（404）：给出可操作的说明', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 404, json: async () => ({ detail: '邀请链接无效或已被使用' }) })),
    )
    renderJoin('/join?token=tok-used000000')

    expect(await screen.findByTestId('join-error')).toHaveTextContent(/无效|过期|已被使用/)
  })

  it('链接缺 token：不打接口，直接说明', () => {
    const fetchMock = vi.fn(async (_url: string, _options?: RequestInit) => okJson({}))
    vi.stubGlobal('fetch', fetchMock)
    renderJoin('/join')

    expect(screen.getByTestId('join-error')).toHaveTextContent('缺少 token')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
