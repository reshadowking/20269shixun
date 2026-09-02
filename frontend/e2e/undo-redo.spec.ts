import { expect, test, type Page } from '@playwright/test'

/**
 * P0-1 操作级撤销/重做 E2E（缺陷 13）：
 * 删除节点 → Ctrl+Z 恢复 → Ctrl+Shift+Z 再删除。
 * 前置：后端 + Vite + y-websocket（纯前端操作，无 LLM 依赖）。
 */

// 每测试唯一协作 room：隔离 y-websocket 状态（避免测试间残留覆盖）
let ROOM = 'e2e-' + Math.random().toString(36).slice(2, 10)

async function login(page: Page) {
  await page.goto('/workspace?room=' + ROOM)
  await page.getByTestId('login-password').waitFor({ state: 'visible', timeout: 10_000 })
  await page.getByTestId('login-password').fill('demo123')
  await page.getByTestId('login-submit').click()
  await expect(page.getByTestId('workspace-page')).toBeVisible({ timeout: 10_000 })
}

test('删除节点 → Ctrl+Z 恢复 → Ctrl+Shift+Z 重做', async ({ page }) => {
  ROOM = 'e2e-' + Math.random().toString(36).slice(2, 10)
  test.setTimeout(60_000)
  await login(page)

  // 等待画布渲染（coupon 示例）
  const node = page.locator('[data-node-id="coupon-title"]')
  await expect(node.first()).toBeVisible({ timeout: 10_000 })

  // 选中节点（pointerdown 选中）
  await node.first().click({ position: { x: 10, y: 10 } })

  // 删除
  await page.keyboard.press('Delete')
  await expect(node).toHaveCount(0)

  // 撤销恢复
  await page.keyboard.press('Control+z')
  await expect(node.first()).toBeVisible({ timeout: 5_000 })

  // 重做再删
  await page.keyboard.press('Control+Shift+z')
  await expect(node).toHaveCount(0, { timeout: 5_000 })

  // 顶栏按钮存在
  await expect(page.getByTestId('undo-op')).toBeVisible()
  await expect(page.getByTestId('redo-op')).toBeVisible()
})
