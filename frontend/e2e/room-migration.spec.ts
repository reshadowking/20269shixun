import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

/**
 * B3 回归：新建设计保存后 room 迁移到 design-{id}——
 * 标签 A 从空白画布新建并保存（reconnectRoom），标签 B 用 ?design={id} 打开同一设计，
 * 双标签进入同一房间实时同步；顺带验证 B3-3 的"本地有未同步修改"提示。
 * 前置：后端 uvicorn :8000 + Vite dev :5173 + y-websocket :1234。
 */

async function loginIfNeeded(page: Page) {
  if (await page.getByTestId('login-password').isVisible().catch(() => false)) {
    await page.getByTestId('login-password').fill('demo123')
    await page.getByTestId('login-submit').click()
  }
}

async function findDesignId(request: APIRequestContext, name: string): Promise<number> {
  const login = await request.post('http://localhost:8000/api/auth/login', { data: { username: 'demo', password: 'demo123' } })
  const token = (await login.json()).token
  const resp = await request.get('http://localhost:8000/api/designs', { headers: { Authorization: `Bearer ${token}` } })
  const designs = (await resp.json()).designs as Array<{ id: number; name: string }>
  const hit = designs.find((d) => d.name === name)
  expect(hit).toBeTruthy()
  return hit!.id
}

test('新建→保存→room 迁移→另一标签打开同一设计实时同步', async ({ page, request }) => {
  test.setTimeout(120_000)
  const designName = `E2E-RoomMig-${Date.now()}`

  // 标签 A：空白画布起手
  await page.goto('/workspace?from=blank')
  await loginIfNeeded(page)
  await expect(page.getByTestId('workspace-page')).toBeVisible({ timeout: 15_000 })

  // A 添加一个按钮
  await page.getByTestId('palette-button').click()
  const buttonA = page.locator('[data-node-id^="button-"]').last()
  await expect(buttonA).toBeVisible({ timeout: 10_000 })

  // A 保存（命名）→ 成功后 room 迁移到 design-{id}（内部 reconnectRoom）
  await page.getByTestId('save-design').click()
  await expect(page.getByTestId('save-dialog')).toBeVisible()
  await page.getByTestId('save-name-input').fill(designName)
  await page.getByTestId('save-name-confirm').click()
  await expect(page.getByTestId('design-name')).toHaveText(designName, { timeout: 10_000 })
  // 刚保存完：不应有"未保存"提示
  await expect(page.getByTestId('unsaved-indicator')).toHaveCount(0)

  // 标签 B：用 ?design={id} 打开同一设计（room 派生 design-{id}，与 A 保存后同房）
  const designId = await findDesignId(request, designName)
  const pageB = await page.context().newPage()
  await pageB.goto(`/workspace?design=${designId}`)
  await loginIfNeeded(pageB)
  await expect(pageB.getByTestId('workspace-page')).toBeVisible({ timeout: 15_000 })
  await expect(pageB.locator('[data-node-id^="button-"]').last()).toBeVisible({ timeout: 15_000 })

  // A 修改按钮文本 → B 实时同步出现同一文本
  await buttonA.click()
  const textInput = page.getByTestId('prop-text')
  await expect(textInput).toBeVisible()
  await textInput.fill('跨房间同步文本')
  await expect(pageB.getByText('跨房间同步文本')).toBeVisible({ timeout: 10_000 })

  // B3-3：A 改动后出现"未保存"提示
  await expect(page.getByTestId('unsaved-indicator')).toBeVisible({ timeout: 10_000 })

  // A 再次保存 → 提示消失
  await page.getByTestId('save-design').click()
  await expect(page.getByTestId('unsaved-indicator')).toHaveCount(0, { timeout: 10_000 })

  await pageB.close()
})
