import { expect, test, type Page } from '@playwright/test'

/**
 * P1 主界面文件系统 E2E（缺陷 5/6/8/16/17）：
 * 启动页 → 模板起手 → 工作台保存 → 回主页打开恢复。
 * 前置：后端（designs 接口）+ Vite + y-websocket。
 */

let ROOM = 'e2e-' + Math.random().toString(36).slice(2, 10)

async function loginHome(page: Page) {
  ROOM = 'e2e-' + Math.random().toString(36).slice(2, 10)
  await page.goto('/?room=' + ROOM)
  if (await page.getByTestId('login-password').isVisible().catch(() => false)) {
    await page.getByTestId('login-password').fill('demo123')
    await page.getByTestId('login-submit').click()
  }
  await expect(page.getByTestId('home-user')).toBeVisible({ timeout: 10_000 })
}

test('启动页 → 模板 → 保存 → 回主页打开恢复', async ({ page }) => {
  test.setTimeout(90_000)
  await loginHome(page)

  // 模板列表加载（含登录页模板卡片）
  await expect(page.getByTestId('home-template-login')).toBeVisible({ timeout: 10_000 })

  // 从模板起手 → 工作台
  await page.getByTestId('home-template-login').click()
  await expect(page.getByTestId('workspace-page')).toBeVisible({ timeout: 10_000 })
  await expect(page.getByTestId('node-login-root').first()).toBeVisible({ timeout: 10_000 })

  // 保存（命名）
  await page.getByTestId('save-design').click()
  await expect(page.getByTestId('save-dialog')).toBeVisible()
  await page.getByTestId('save-name-input').fill('E2E 登录页')
  await page.getByTestId('save-name-confirm').click()
  // 保存后显示文件名
  await expect(page.getByTestId('design-name')).toHaveText('E2E 登录页', { timeout: 10_000 })

  // 回主页：最近设计里有该设计
  await page.getByTestId('go-home').click()
  await expect(page.getByTestId('home-user')).toBeVisible({ timeout: 10_000 })
  await expect(page.getByTestId('home-designs')).toBeVisible()
  const card = page.locator('[data-testid^="home-design-"]').filter({ hasText: 'E2E 登录页' })
  await expect(card.first()).toBeVisible({ timeout: 10_000 })

  // 打开恢复 → 工作台画布内容正确
  await card.first().click()
  await expect(page.getByTestId('workspace-page')).toBeVisible({ timeout: 10_000 })
  await expect(page.getByTestId('node-login-root').first()).toBeVisible({ timeout: 10_000 })
  await expect(page.getByTestId('design-name')).toHaveText('E2E 登录页')
})
