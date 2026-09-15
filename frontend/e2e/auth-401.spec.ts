import { expect, test } from '@playwright/test'

/**
 * P0-3 回归：凭证失效（401）必须"清凭证 + 跳登录页"，而不是停在工作台刷一屏 401。
 * 对应施工单 §3.6② 的手工验证，这里自动化。
 */

test('凭证失效：自动跳登录并保留 redirect；重新登录后回到原页面', async ({ page }) => {
  test.setTimeout(120_000)
  await page.goto('/')
  if (await page.getByTestId('login-password').isVisible().catch(() => false)) {
    await page.getByTestId('login-password').fill('demo123')
    await page.getByTestId('login-submit').click()
  }
  await expect(page.getByTestId('home-user')).toBeVisible({ timeout: 15_000 })

  // 篡改 token（模拟：过期/换密钥/被清空后的僵尸凭证）
  await page.evaluate(() => localStorage.setItem('design-tool-token', 'not-a-jwt'))
  await page.goto('/workspace?session=s-401-check')

  // 期望：跳到登录页并带上回来路，而不是停在工作台
  await expect(page).toHaveURL(/\/login\?redirect=/, { timeout: 20_000 })
  expect(decodeURIComponent(page.url().split('redirect=')[1])).toContain('/workspace')
  // 本地凭证已被清理（避免后续请求继续 401）
  expect(await page.evaluate(() => localStorage.getItem('design-tool-token'))).toBeNull()

  // 重新登录 → 回到 redirect 指向的页面
  await page.getByTestId('login-password').fill('demo123')
  await page.getByTestId('login-submit').click()
  await expect(page).toHaveURL(/session=s-401-check/, { timeout: 20_000 })
  await expect(page.getByTestId('workspace-page')).toBeVisible({ timeout: 15_000 })
})

test('后端侧：坏 token 一律 401，有效 token 200；/api/auth/me 可用', async ({ page, request }) => {
  // 无 / 坏 token → 401
  expect((await request.get('/api/generate/templates')).status()).toBe(401)
  expect((await request.get('/api/generate/templates', { headers: { Authorization: 'Bearer not-a-jwt' } })).status()).toBe(401)
  expect((await request.get('/api/auth/me', { headers: { Authorization: 'Bearer not-a-jwt' } })).status()).toBe(401)

  // 有效 token → 200
  const login = await request.post('/api/auth/login', { data: { username: 'demo', password: 'demo123' } })
  expect(login.status()).toBe(200)
  const token = (await login.json()).token as string
  expect((await request.get('/api/generate/templates', { headers: { Authorization: `Bearer ${token}` } })).status()).toBe(200)
  const me = await request.get('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } })
  expect(me.status()).toBe(200)
  expect((await me.json()).username).toBe('demo')
  void page
})
