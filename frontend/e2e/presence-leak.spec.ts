import { expect, test } from '@playwright/test'

/**
 * T2 回归：presence 连接泄漏——同一个人反复「进工作台 → 回主页 → 再进」，
 * 右上角在线人数必须始终为 1。
 * 修复前：WorkspaceInner 每次挂载新建 WebsocketProvider 且从不销毁，旧连接
 * 残留在 y-websocket 房间里，人数 1→2→3→4（整页刷新才复原）。
 * 注意：进出必须走 SPA 内导航（go-home 链接 + 浏览器返回），整页刷新会
 * 关闭所有连接、掩盖泄漏。前置：后端 :8000 + Vite :5173 + y-websocket :1234。
 */

test('反复进出工作台：在线人数恒为 1（provider 随卸载销毁）', async ({ page }) => {
  test.setTimeout(120_000)
  const ROOM = 'e2e-presence-leak-' + Math.random().toString(36).slice(2, 10)

  await page.goto(`/workspace?room=${ROOM}&user=Alice`)
  if (await page.getByTestId('login-password').isVisible().catch(() => false)) {
    await page.getByTestId('login-password').fill('demo123')
    await page.getByTestId('login-submit').click()
  }
  await expect(page.getByTestId('workspace-page')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId('presence-count')).toContainText('1 人在线', { timeout: 15_000 })

  for (let i = 0; i < 3; i++) {
    await page.getByTestId('go-home').click()
    await expect(page.getByTestId('home-goto-workspace')).toBeVisible({ timeout: 15_000 })
    // 浏览器返回 = SPA popstate，恢复同一房间 URL（room 与 user 均保留）
    await page.goBack()
    await expect(page.getByTestId('workspace-page')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId('presence-count')).toContainText('1 人在线', { timeout: 15_000 })
  }
})
