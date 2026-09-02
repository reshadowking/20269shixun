import { expect, test, type Page } from '@playwright/test'

/**
 * P0-1 增量编辑 E2E：修改类指令 → 携带当前树 → 只改指定节点 → 高亮 → 撤销恢复。
 * /api/generate 用 route mock（确定性）：把请求中的 design 里第一个 button 改为红色后返回。
 * 前置：后端 + Vite + y-websocket 运行中（mock 响应不依赖真实 LLM）。
 */

// 每测试唯一协作 room：隔离 y-websocket 状态（避免测试间残留覆盖）
let ROOM = 'e2e-' + Math.random().toString(36).slice(2, 10)

async function login(page: Page) {
  await page.goto('/workspace?room=' + ROOM)
  if (await page.getByTestId('login-password').isVisible().catch(() => false)) {
    await page.getByTestId('login-password').fill('demo123')
    await page.getByTestId('login-submit').click()
  }
  await expect(page.getByTestId('workspace-page')).toBeVisible()
}

async function openChat(page: Page) {
  await page.getByTestId('activity-ai').click()
  await expect(page.getByTestId('ai-chat-panel')).toBeVisible()
}

test('增量修改：只改指定按钮、高亮、可撤销', async ({ page }) => {
  ROOM = 'e2e-' + Math.random().toString(36).slice(2, 10)
  test.setTimeout(60_000)

  // route mock：返回"把请求 design 中第一个 button 改成红色"的树
  let receivedDesign: unknown = null
  await page.route('**/api/generate', async (route) => {
    const body = route.request().postDataJSON()
    receivedDesign = body.design ?? null

    const design = JSON.parse(JSON.stringify(body.design))
    const findButton = (node: Record<string, unknown>): Record<string, unknown> | null => {
      if (node.componentType === 'button' || node.type === 'button') return node
      for (const c of (node.children as Array<Record<string, unknown>>) ?? []) {
        const hit = findButton(c)
        if (hit) return hit
      }
      return null
    }
    const btn = findButton(design)
    if (btn) {
      btn.style = { ...(btn.style ?? {}), color: '#FF0000' }
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ design, template: 'edit', compliance: 100, violations: 0, fallback: false }),
    })
  })

  await login(page)
  await openChat(page)

  // 发送修改指令
  await page.getByTestId('chat-input').fill('把按钮改成红色')
  await page.getByTestId('chat-send').click()

  // 1. 请求携带当前画布树（增量模式）
  await expect.poll(() => receivedDesign).not.toBeNull()
  expect((receivedDesign as Record<string, unknown>).id).toBeTruthy()

  // 2. 消息提示"已应用修改"
  await expect(page.getByText(/已应用修改/)).toBeVisible({ timeout: 10_000 })

  // 3. 被修改的按钮高亮（data-highlighted 标记，5 秒内消失）
  await expect(page.locator('[data-highlighted="true"]').first()).toBeVisible({ timeout: 5_000 })

  // 4. 撤销 → 回到修改前（高亮消失）
  await page.getByTestId('chat-input').fill('撤销')
  await page.getByTestId('chat-send').click()
  await expect(page.getByText(/已撤销/)).toBeVisible()
  await expect(page.locator('[data-highlighted="true"]')).toHaveCount(0)
})
