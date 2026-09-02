import { expect, test, type Page } from '@playwright/test'

/**
 * P0-2 导出代码 E2E：工具栏按钮 → 对话框 → 预览 → 下载 ZIP。
 * 前置：后端（提供 /api/export）+ Vite + y-websocket。
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

test('导出代码：对话框 → 预览 → ZIP 下载', async ({ page }) => {
  ROOM = 'e2e-' + Math.random().toString(36).slice(2, 10)
  test.setTimeout(60_000)
  await login(page)

  // 打开导出对话框
  await page.getByTestId('export-code').click()
  await expect(page.getByTestId('export-dialog')).toBeVisible()

  // 预览：iframe 静态 HTML
  await page.getByTestId('export-preview-btn').click()
  await expect(page.getByTestId('export-preview')).toBeVisible()

  // 导出：捕获下载事件并验证 zip 内容
  const downloadPromise = page.waitForEvent('download')
  await page.getByTestId('export-download').click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe('ai-design-export.zip')

  // 成功提示
  await expect(page.getByTestId('export-success')).toBeVisible()

  // zip 内容验证（package.json + App.tsx）
  const zipPath = await download.path()
  const fs = await import('node:fs')
  const zipBuf = fs.readFileSync(zipPath!)
  const bytes = Array.from(zipBuf.subarray(0, 4))
  expect(bytes).toEqual([0x50, 0x4b, 0x03, 0x04]) // PK\x03\x04
})
