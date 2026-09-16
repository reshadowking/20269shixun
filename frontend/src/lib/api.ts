/**
 * 后端 API 封装（v2.2 §12：不写死 mock，header 带 token，错误友好提示）。
 * 开发期经 Vite 代理 /api → localhost:8000；生产走同源或 API_BASE_URL。
 */
const API_BASE = import.meta.env.VITE_API_BASE_URL ?? ''

const TOKEN_KEY = 'design-tool-token'
const USER_KEY = 'design-tool-user'
const COOKIE_NAME = 'design_token'

/**
 * T46b：把 JWT 同步到同源 cookie。
 *
 * 为什么需要：资产（图片）读取是 `<img src="/api/images/12">` —— 浏览器自己发这个请求，
 * **不会带 Authorization 头**。同源 cookie 会自动带上，让 private / workspace 档位的图
 * 在画布与资产库里正常显示（后端 `GET /api/images/{id}` 同时接受 Bearer 与 cookie）。
 * 无 token 时清掉，避免退出登录后仍能读到图。
 */
function syncAuthCookie(token: string | null): void {
  try {
    if (!token) {
      document.cookie = `${COOKIE_NAME}=; path=/; max-age=0; SameSite=Lax`
      return
    }
    if (document.cookie.split('; ').includes(`${COOKIE_NAME}=${token}`)) return
    document.cookie = `${COOKIE_NAME}=${token}; path=/; SameSite=Lax`
  } catch {
    /* 非浏览器环境（测试/SSR）：忽略 */
  }
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

export function setAuth(token: string, username: string) {
  localStorage.setItem(TOKEN_KEY, token)
  localStorage.setItem(USER_KEY, username)
  syncAuthCookie(token)
}

export function clearAuth() {
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(USER_KEY)
  syncAuthCookie(null)
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

/** 字段名 → 中文（只列前端能触达的；没登记的字段直接用原名） */
const FIELD_LABELS: Record<string, string> = {
  username: '账号',
  password: '密码',
  name: '名称',
  role: '角色',
  visibility: '可见性',
  folder_id: '文件夹',
  ids: '排序列表',
  token: '邀请链接',
  design: '设计稿',
  note: '备注',
  q: '搜索词',
  sort: '排序方式',
  limit: '条数',
  offset: '偏移量',
}

/** Pydantic 校验类型 → 人话（ctx 里带上下限等参数） */
const TYPE_HINTS: Record<string, (ctx: Record<string, unknown>) => string> = {
  string_too_short: (ctx) => `至少需要 ${ctx.min_length ?? ''} 个字符`,
  string_too_long: (ctx) => `最多 ${ctx.max_length ?? ''} 个字符`,
  string_pattern_mismatch: () => '格式不正确（只允许字母、数字、下划线、连字符）',
  missing: () => '不能为空',
  int_parsing: () => '必须是整数',
  int_type: () => '必须是整数',
  bool_parsing: () => '必须是布尔值',
  greater_than_equal: (ctx) => `不能小于 ${ctx.ge ?? ''}`,
  less_than_equal: (ctx) => `不能大于 ${ctx.le ?? ''}`,
}

/**
 * 把后端错误体转成**人话**（2026-09-16）。
 *
 * 之前 `api()` 对非字符串 detail 直接 `JSON.stringify` —— 注册时密码填 "111"，
 * 用户看到的是一整串 `[{"type":"string_too_short","loc":["body","password"],…}]`，
 * 完全不知道该怎么办。这里把 Pydantic 的校验错误逐条翻译成"字段：原因"。
 */
export function formatApiDetail(detail: unknown): string {
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail)) {
    const parts = detail.slice(0, 3).map((item) => {
      if (!item || typeof item !== 'object') return String(item)
      const err = item as { type?: string; loc?: unknown[]; msg?: string; ctx?: Record<string, unknown> }
      const field = Array.isArray(err.loc) ? String(err.loc[err.loc.length - 1] ?? '') : ''
      const label = field ? (FIELD_LABELS[field] ?? field) : ''
      const hint = err.type ? TYPE_HINTS[err.type]?.(err.ctx ?? {}) : undefined
      const text = (hint ?? err.msg ?? '格式不正确').replace(/^Value error,\s*/i, '')
      return label ? `${label}：${text}` : text
    })
    const more = detail.length > 3 ? `（还有 ${detail.length - 3} 项）` : ''
    return parts.join('；') + more
  }
  if (detail && typeof detail === 'object') {
    const msg = (detail as { msg?: unknown }).msg
    if (typeof msg === 'string') return msg
  }
  return '请求失败'
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
  // T46b：给"本改造之前就已登录"的会话补 cookie（否则图片会突然读不到）
  syncAuthCookie(token)

  const resp = await fetch(`${API_BASE}${path}`, { ...options, headers })
  if (resp.status === 401) {
    handleUnauthorized()
    throw new ApiError(401, '登录已过期，请重新登录')
  }
  if (!resp.ok) {
    let detail = `请求失败（${resp.status}）`
    try {
      const body = await resp.json()
      if (body.detail) detail = formatApiDetail(body.detail)
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
