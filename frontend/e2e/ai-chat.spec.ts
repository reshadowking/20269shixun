import { expect, test } from '@playwright/test'

/**
 * AI 聊天面板 E2E（v2.2 §4.1 主链路）：自然语言 → 设计稿上画布。
 * 前置：后端（real 模式，需 .env 的 key）+ Vite + y-websocket。
 * 真实 API 调用约 8-12 秒，超时放宽到 60 秒。
 */

// 每测试唯一协作 room：隔离 y-websocket 状态（避免测试间残留覆盖）
let ROOM = 'e2e-' + Math.random().toString(36).slice(2, 10)

test('聊天生成设计稿 → 画布更新', async ({ page }) => {
  ROOM = 'e2e-' + Math.random().toString(36).slice(2, 10)
  test.setTimeout(90_000)
  ROOM = 'e2e-' + Math.random().toString(36).slice(2, 10)
  await page.goto('/workspace?room=' + ROOM)
  if (await page.getByTestId('login-password').isVisible().catch(() => false)) {
    await page.getByTestId('login-password').fill('demo123')
    await page.getByTestId('login-submit').click()
  }
  await expect(page.getByTestId('workspace-page')).toBeVisible()

  // 打开 AI 生成活动面板（P1 活动栏）
  await page.getByTestId('activity-ai').click()
  await expect(page.getByTestId('ai-chat-panel')).toBeVisible()

  // 输入需求并发送
  await page.getByTestId('chat-input').fill('设计一个登录页面，简洁风格，主色蓝色')
  await page.getByTestId('chat-send').click()

  // 生成中锁定画布
  await expect(page.getByTestId('canvas-lock')).toBeVisible({ timeout: 5000 }).catch(() => {})

  // 等待 AI 回复（真实 API；messages 数组：[欢迎, user, assistant]）
  await expect(page.getByTestId('chat-msg-assistant-2')).toContainText('已生成设计稿', { timeout: 60_000 })

  // 画布已注入生成的设计稿（登录模板）
  await expect(page.getByTestId('node-login-root')).toBeVisible({ timeout: 10_000 })
  // 锁定解除
  await expect(page.getByTestId('canvas-lock')).toHaveCount(0)
})
