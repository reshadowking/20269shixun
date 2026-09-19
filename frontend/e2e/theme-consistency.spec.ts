/**
 * 深色模式跨页面一致（2026-09-18）。
 *
 * 用户实测反馈过的现象："我当前设定是暗色模式，结果到了 API 配置页面刚开始还是黑色，
 * 刷新后配置变成白色了；退出去检查，系统主页也变成亮色了。"
 *
 * 根因：**两套存储**——AppShell 走 `lib/theme.ts`（键 `design-tool-theme`），
 * 工作台自己走 `design-dark`，而两边都会去改同一个 `<html class="dark">`。
 * 于是"在首页开深色 → 进工作台"会被工作台那份（默认浅色）把 dark class 摘掉，
 * 回到首页时按钮还写着"浅色模式"，但页面其实已经是亮的。
 *
 * 现在只有一份存储（老键只读一次做迁移），本用例钉住跨页面一致。
 * 前置：后端 :8000（mock）+ Vite :5173。
 */
import { expect, test } from '@playwright/test'

async function ensureLoggedIn(page: import('@playwright/test').Page, url: string) {
  await page.goto(url)
  if (await page.getByTestId('login-password').isVisible().catch(() => false)) {
    await page.getByTestId('login-password').fill('demo123')
    await page.getByTestId('login-submit').click()
  }
}

test('首页开深色 → 进工作台仍是深色 → 回首页仍深色', async ({ page }) => {
  test.setTimeout(90_000)
  const tag = Math.random().toString(36).slice(2, 8)

  await ensureLoggedIn(page, '/')
  const html = page.locator('html')
  // 从亮色出发（上一个用例/系统偏好可能留下深色）
  if (await html.evaluate((el) => el.classList.contains('dark'))) {
    await page.getByTestId('theme-toggle').click()
  }
  await expect(html).not.toHaveClass(/dark/)

  await page.getByTestId('theme-toggle').click()
  await expect(html).toHaveClass(/dark/)

  // ① 进工作台：必须还是深色（修复前这里会被工作台摘掉 dark class）
  await ensureLoggedIn(page, `/workspace?session=s-theme${tag}&from=blank`)
  await expect(page.getByTestId('workspace-page')).toBeVisible({ timeout: 15_000 })
  await expect(html).toHaveClass(/dark/)
  // 设置面板里的开关也要如实反映（而不是显示"关"）
  await page.getByTestId('activity-settings').click()
  await expect(page.getByTestId('settings-dark')).toBeChecked()

  // ② 在工作台里关掉 → 全局也要跟着亮
  await page.getByTestId('settings-dark').click()
  await expect(html).not.toHaveClass(/dark/)

  // ③ 回首页：状态延续（开关与页面一致）
  await page.goto('/')
  await expect(page.getByTestId('theme-toggle')).toBeVisible()
  await expect(html).not.toHaveClass(/dark/)
})
