import { expect, test } from '@playwright/test'

/**
 * D5 回归：协作在场感（presence）——同房间双标签通过 Yjs awareness 互见在线人数与昵称，
 * 一端关闭后另一端人数回落（y-websocket 断开清理 awareness）。
 * 前置：后端 uvicorn :8000 + Vite dev :5173 + y-websocket :1234。
 */

test('双标签同房间：互见在线人数与昵称，关闭一端后回落', async ({ page }) => {
  test.setTimeout(120_000)
  const ROOM = 'e2e-presence-' + Math.random().toString(36).slice(2, 10)

  // 标签 A（Alice）
  await page.goto(`/workspace?room=${ROOM}&user=Alice`)
  if (await page.getByTestId('login-password').isVisible().catch(() => false)) {
    await page.getByTestId('login-password').fill('demo123')
    await page.getByTestId('login-submit').click()
  }
  await expect(page.getByTestId('workspace-page')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId('presence-count')).toContainText('1 人在线', { timeout: 15_000 })

  // 标签 B（Bob）加入同一房间
  const pageB = await page.context().newPage()
  await pageB.goto(`/workspace?room=${ROOM}&user=Bob`)
  await expect(pageB.getByTestId('workspace-page')).toBeVisible({ timeout: 15_000 })

  // A 看到 2 人在线，且昵称含 Alice/Bob
  await expect(page.getByTestId('presence-count')).toContainText('2 人在线', { timeout: 15_000 })
  await expect(page.getByTestId('presence-count')).toHaveAttribute('title', /Alice/)
  await expect(page.getByTestId('presence-count')).toHaveAttribute('title', /Bob/)
  // B 也看到 2 人
  await expect(pageB.getByTestId('presence-count')).toContainText('2 人在线', { timeout: 15_000 })

  // B 关闭 → A 人数回落为 1（服务端 awareness 清理含 30s 超时兜底，给足等待窗口）
  await pageB.close()
  await expect(page.getByTestId('presence-count')).toContainText('1 人在线', { timeout: 45_000 })
})
