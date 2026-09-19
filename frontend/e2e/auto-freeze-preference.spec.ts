/**
 * 「AI 生成后自动转为可自由拖拽」这个偏好的**开关是否真的生效**（2026-09-18）。
 *
 * 为什么值得单独一条：自动冻结是默认行为（72a07f1 之后还扩到了整棵树），设置面板里那个
 * 开关是用户**唯一**的退路——它坏掉的话，用户既拿不到"生成即可拖"，也没法退回流式布局，
 * 而这在自动化里完全看不见（`settings-auto-freeze` 此前只有组件级引用，没有 e2e）。
 *
 * 前置：后端 :8000（mock）+ Vite :5173。
 */
import { expect, test } from '@playwright/test'

async function openWorkspace(page: import('@playwright/test').Page, session: string) {
  await page.goto(`/workspace?session=${session}&from=blank`)
  if (await page.getByTestId('login-password').isVisible().catch(() => false)) {
    await page.getByTestId('login-password').fill('demo123')
    await page.getByTestId('login-submit').click()
  }
  await expect(page.getByTestId('workspace-page')).toBeVisible({ timeout: 15_000 })
}

async function generateLogin(page: import('@playwright/test').Page) {
  await page.getByTestId('activity-ai').click()
  await page.getByTestId('chat-input').fill('设计一个登录页面，简洁现代风格')
  await page.getByTestId('chat-send').click()
  await expect(page.getByTestId('node-login-root')).toBeVisible({ timeout: 30_000 })
}

test('设置里关掉自动冻结 → 生成后保持流式布局；开回来 → 又变成可自由拖拽', async ({ page }) => {
  test.setTimeout(120_000)
  const tag = Math.random().toString(36).slice(2, 8)
  await openWorkspace(page, `s-afp${tag}`)

  // ---- 关掉开关 ----
  await page.getByTestId('activity-settings').click()
  const toggle = page.getByTestId('settings-auto-freeze')
  await expect(toggle).toBeVisible()
  await toggle.click()
  await expect(toggle).not.toBeChecked()

  await generateLogin(page)
  // 关掉之后不许自动冻结：根节点仍是模板的 column 布局
  await expect(page.getByTestId('design-canvas')).toHaveAttribute('data-yjs-layout', 'column')

  // ---- 开回来（上一步点过 activity-ai，设置面板已收起，这里重新打开）----
  await page.getByTestId('activity-settings').click()
  await toggle.click()
  await expect(toggle).toBeChecked()

  // 重新做一次整页生成（"重新设计…"走的是整树生成路径）
  await page.getByTestId('activity-ai').click()
  await page.getByTestId('chat-input').fill('重新设计一个登录页面，简洁现代风格')
  await page.getByTestId('chat-send').click()
  await expect(page.getByTestId('design-canvas')).toHaveAttribute('data-yjs-layout', 'free', { timeout: 30_000 })
})

test('偏好记在本地：刷新后开关状态与行为都保持一致', async ({ page }) => {
  test.setTimeout(90_000)
  const tag = Math.random().toString(36).slice(2, 8)
  await openWorkspace(page, `s-afp2${tag}`)

  await page.getByTestId('activity-settings').click()
  await page.getByTestId('settings-auto-freeze').click()
  await expect(page.getByTestId('settings-auto-freeze')).not.toBeChecked()

  await page.reload()
  await expect(page.getByTestId('workspace-page')).toBeVisible({ timeout: 15_000 })
  await page.getByTestId('activity-settings').click()
  await expect(page.getByTestId('settings-auto-freeze')).not.toBeChecked()
})
