import { expect, test, type APIRequestContext } from '@playwright/test'

/**
 * P0-5 回归：保存失败必须可见（此前 PUT 失败静默吞错，用户误以为已保存到后端）。
 * 用 page.route 拦截 PUT /api/designs/{id} 返回 500 → save-error 提示出现；解除拦截后重试成功。
 * 前置：后端 uvicorn :8000 + Vite dev :5173 + y-websocket :1234。
 */

const DESIGN = {
  id: 'root-saveerr', type: 'frame', style: { layout: 'column', width: 500, gap: 8, padding: 20 },
  children: [{ id: 'ts', type: 'text', props: { text: '保存错误测试' } }],
}

async function createDesign(request: APIRequestContext): Promise<number> {
  const login = await request.post('http://localhost:8000/api/auth/login', { data: { username: 'demo', password: 'demo123' } })
  const token = (await login.json()).token
  const resp = await request.post('http://localhost:8000/api/designs', {
    headers: { Authorization: `Bearer ${token}` },
    data: { name: 'E2E-SaveError', design: DESIGN },
  })
  expect(resp.ok()).toBeTruthy()
  return (await resp.json()).id
}

test('保存失败显示 save-error 提示，恢复后重试成功', async ({ page, request }) => {
  test.setTimeout(90_000)
  const id = await createDesign(request)

  await page.goto(`/workspace?design=${id}`)
  if (await page.getByTestId('login-password').isVisible().catch(() => false)) {
    await page.getByTestId('login-password').fill('demo123')
    await page.getByTestId('login-submit').click()
  }
  await expect(page.getByTestId('workspace-page')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId('node-ts')).toBeVisible({ timeout: 15_000 })

  // 拦截 PUT 保存 → 500
  await page.route('**/api/designs/*', async (route) => {
    if (route.request().method() === 'PUT') {
      await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ detail: '模拟服务器错误' }) })
      return
    }
    await route.continue()
  })
  await page.getByTestId('save-design').click()
  await expect(page.getByTestId('save-error')).toBeVisible({ timeout: 10_000 })

  // 解除拦截 → 重试成功 → 提示消失
  await page.unroute('**/api/designs/*')
  await page.getByTestId('save-design').click()
  await expect(page.getByTestId('save-error')).not.toBeVisible({ timeout: 10_000 })
})
