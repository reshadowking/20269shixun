import { expect, test } from '@playwright/test'

/**
 * D3 回归：方案探索（/api/generate/explore）——聊天面板探索 2 份方案 → 采用后快照可撤销。
 * 环境：mock LLM（无 Key 时方案为模板稿 degraded=true，结构断言不受影响）。
 * 前置：后端 uvicorn :8000 + Vite dev :5173 + y-websocket :1234。
 */

test('方案探索：生成一次后探索 2 方案 → 采用 → 快照撤销可用', async ({ page }) => {
  test.setTimeout(120_000)
  const ROOM = 'e2e-' + Math.random().toString(36).slice(2, 10)

  await page.goto(`/workspace?room=${ROOM}`)
  if (await page.getByTestId('login-password').isVisible().catch(() => false)) {
    await page.getByTestId('login-password').fill('demo123')
    await page.getByTestId('login-submit').click()
  }
  await expect(page.getByTestId('workspace-page')).toBeVisible({ timeout: 15_000 })

  await page.getByTestId('activity-ai').click()
  await expect(page.getByTestId('ai-chat-panel')).toBeVisible()

  // 先生成一次（lastPrompt 就位；带风格词避免触发追问；mock 环境走模板稿）
  await page.getByTestId('chat-input').fill('设计一个登录页面，简洁现代风格')
  await page.getByTestId('chat-send').click()
  await expect(page.getByTestId('chat-msg-assistant-2')).toContainText('已生成设计稿', { timeout: 30_000 })
  await expect(page.getByTestId('node-login-root').first()).toBeVisible({ timeout: 10_000 })

  // 探索 2 份方案
  await page.getByTestId('explore-options').click()
  await expect(page.getByTestId('explore-result')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByTestId('explore-option-0')).toContainText('方案一')
  await expect(page.getByTestId('explore-option-1')).toContainText('方案二')

  // 采用方案一：面板关闭 + 快照记录（撤销按钮出现）
  await page.getByTestId('explore-use-0').click()
  await expect(page.getByTestId('explore-result')).toHaveCount(0)
  await expect(page.getByText(/已加载「方案一/)).toBeVisible({ timeout: 10_000 })
  await expect(page.getByTestId('undo-optimize')).toBeVisible({ timeout: 10_000 })

  // 快照撤销：回到加载前
  await page.getByTestId('undo-optimize').click()
  await expect(page.getByTestId('node-login-root').first()).toBeVisible({ timeout: 10_000 })
})
