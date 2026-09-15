/**
 * 后端 API 封装（v2.2 §12：不写死 mock，header 带 token，错误友好提示）。
 * 开发期经 Vite 代理 /api → localhost:8000；生产走同源或 API_BASE_URL。
 */
const API_BASE = import.meta.env.VITE_API_BASE_URL ?? ''

const TOKEN_KEY = 'design-tool-token'
const USER_KEY = 'design-tool-user'

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

export function setAuth(token: string, username: string) {
  localStorage.setItem(TOKEN_KEY, token)
  localStorage.setItem(USER_KEY, username)
}

export function clearAuth() {
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(USER_KEY)
}

export function getUsername(): string | null {
  return localStorage.getItem(USER_KEY)
}

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

/**
 * 401 统一处理（P0-3）：清凭证 + 跳登录页。
 *
 * 原实现只 clearAuth() 不跳转，于是一条 401 会连锁：凭证被清 → 后续所有请求都没带 token →
 * 全部 401，用户看到的是"满屏 401"而不是登录页。这里补上跳转（带 redirect 回来路）。
 */
export function handleUnauthorized(): void {
  clearAuth()
  try {
    if (window.location.pathname.startsWith('/login')) return // 已在登录页，避免自我重定向
    const redirect = encodeURIComponent(`${window.location.pathname}${window.location.search}`)
    window.location.assign(`/login?redirect=${redirect}`)
  } catch {
    /* 非浏览器环境（测试/SSR）：忽略跳转 */
  }
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> | undefined),
  }
  const token = getToken()
  if (token) headers['Authorization'] = `Bearer ${token}`

  const resp = await fetch(`${API_BASE}${path}`, { ...options, headers })
  if (resp.status === 401) {
    handleUnauthorized()
    throw new ApiError(401, '登录已过期，请重新登录')
  }
  if (!resp.ok) {
    let detail = `请求失败（${resp.status}）`
    try {
      const body = await resp.json()
      if (body.detail) detail = typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail)
    } catch {
      /* 非 JSON 响应，保留默认错误 */
    }
    throw new ApiError(resp.status, detail)
  }
  return resp.json() as Promise<T>
}

export async function login(username: string, password: string) {
  const resp = await api<{ token: string; username: string }>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  })
  setAuth(resp.token, resp.username)
  return resp
}

/** T46a-4：开放注册（后端建用户 + 个人工作区，直接返回 token）。 */
export async function register(username: string, password: string) {
  const resp = await api<{ token: string; username: string }>('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  })
  setAuth(resp.token, resp.username)
  return resp
}
