/**
 * P0-3 回归：401 必须"清凭证 + 跳登录"，不能只清凭证（否则一条 401 连锁成满屏 401）。
 * P0-2 回归：同会话的并发 ensure 只发一次请求。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError, api, formatApiDetail, getToken, handleUnauthorized, setAuth } from './api'
import { sessionApi } from './sessionApi'

function jsonResponse(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body }
}

describe('handleUnauthorized（P0-3）', () => {
  let assignSpy: ReturnType<typeof vi.fn>

  function stubLocation(pathname: string, search = '') {
    assignSpy = vi.fn()
    vi.stubGlobal('location', { pathname, search, assign: assignSpy })
  }

  beforeEach(() => {
    localStorage.clear()
    setAuth('tok-123', 'demo')
    stubLocation('/workspace', '?session=s-1')
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    localStorage.clear()
  })

  it('清掉凭证并跳登录页（带 redirect 回来路）', () => {
    handleUnauthorized()
    expect(getToken()).toBeNull()
    expect(assignSpy).toHaveBeenCalledTimes(1)
    const url = String(assignSpy.mock.calls[0][0])
    expect(url.startsWith('/login?redirect=')).toBe(true)
    expect(decodeURIComponent(url.split('redirect=')[1])).toBe('/workspace?session=s-1')
  })

  it('已在登录页时不再重复跳转（避免自我重定向）', () => {
    stubLocation('/login', '?redirect=%2Fworkspace')
    handleUnauthorized()
    expect(assignSpy).not.toHaveBeenCalled()
    expect(getToken()).toBeNull()
  })

  it('api() 收到 401：清凭证 + 跳转 + 抛 ApiError（调用方仍能感知失败）', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(401, { detail: '凭证无效' })))
    await expect(api('/api/anything')).rejects.toBeInstanceOf(ApiError)
    expect(getToken()).toBeNull()
    expect(assignSpy).toHaveBeenCalledTimes(1)
  })
})

describe('sessionApi.ensure 在途去重（P0-2）', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    localStorage.clear()
  })

  it('同一会话并发调用只发一次请求（StrictMode 双挂载不翻倍）', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, { session_id: 's-dup', title: 't', design_id: null, created_at: null, updated_at: null }))
    vi.stubGlobal('fetch', fetchMock)

    const [a, b] = await Promise.all([sessionApi.ensure('s-dup'), sessionApi.ensure('s-dup')])
    expect(a.session_id).toBe('s-dup')
    expect(b.session_id).toBe('s-dup')
    expect(fetchMock).toHaveBeenCalledTimes(1)

    // 请求结束后去重表清空：后续调用会重新发（保证能拿到最新状态）
    await sessionApi.ensure('s-dup')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('不同会话互不干扰（各自发一次）', async () => {
    const fetchMock = vi.fn(async (url: string) => jsonResponse(200, { session_id: String(url), title: 't', design_id: null, created_at: null, updated_at: null }))
    vi.stubGlobal('fetch', fetchMock)
    await Promise.all([sessionApi.ensure('s-a'), sessionApi.ensure('s-b')])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})

describe('formatApiDetail（2026-09-16：别把校验 JSON 甩给用户）', () => {
  it('把 Pydantic 校验错误翻成人话（就是用户填 "111" 那个场景）', () => {
    const detail = [
      {
        type: 'string_too_short',
        loc: ['body', 'password'],
        msg: 'String should have at least 6 characters',
        ctx: { min_length: 6 },
      },
    ]
    expect(formatApiDetail(detail)).toBe('密码：至少需要 6 个字符')
  })

  it('多条错误合并；超过三条只列前三条并注明还有几项', () => {
    const err = (field: string, type = 'string_too_short', ctx: Record<string, unknown> = { min_length: 3 }) => ({
      type,
      loc: ['body', field],
      ctx,
    })
    expect(formatApiDetail([err('username'), err('password', 'string_too_short', { min_length: 6 })])).toBe(
      '账号：至少需要 3 个字符；密码：至少需要 6 个字符',
    )
    expect(formatApiDetail([err('a'), err('b'), err('c'), err('d')])).toContain('（还有 1 项）')
  })

  it('字符串 detail 原样返回（业务错误文案不受影响）', () => {
    expect(formatApiDetail('用户名已被占用')).toBe('用户名已被占用')
  })

  it('没登记的类型退回后端 msg，未登记字段用原字段名', () => {
    expect(formatApiDetail([{ type: 'value_error', loc: ['body', 'custom_field'], msg: 'Value error, 自定义校验失败' }])).toBe(
      'custom_field：自定义校验失败',
    )
  })

  it('未知形状不抛错（宁可显示"请求失败"也不能崩）', () => {
    expect(formatApiDetail(undefined)).toBe('请求失败')
    expect(formatApiDetail({})).toBe('请求失败')
    expect(formatApiDetail([null, 42])).toBe('null；42')
  })
})
