import { expect, test } from '@playwright/test'

/**
 * D2 回归：图片本地上传——画布 image 组件 → 属性面板选择本地文件 → 上传 /api/images
 * → props.src 更新 → 画布渲染出 <img src="/api/images/{id}">。
 * 前置：后端 uvicorn :8000 + Vite dev :5173 + y-websocket :1234。
 */

// 1x1 透明 PNG
const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

test('图片本地上传 → src 写入 → 画布渲染', async ({ page }) => {
  test.setTimeout(90_000)
  const ROOM = 'e2e-' + Math.random().toString(36).slice(2, 10)

  await page.goto(`/workspace?room=${ROOM}`)
  if (await page.getByTestId('login-password').isVisible().catch(() => false)) {
    await page.getByTestId('login-password').fill('demo123')
    await page.getByTestId('login-submit').click()
  }
  await expect(page.getByTestId('workspace-page')).toBeVisible({ timeout: 15_000 })

  // 加入 image 组件并选中（未设置图片 → 占位）
  await page.getByTestId('palette-image').click()
  const imgNode = page.locator('[data-node-id^="image-"]').last()
  await expect(imgNode).toBeVisible({ timeout: 10_000 })
  await imgNode.click()

  // 属性面板出现上传控件（D2：src 字段为 upload 控件）
  await expect(page.getByTestId('upload-image-btn')).toBeVisible({ timeout: 10_000 })

  // 选择本地文件上传
  await page.getByTestId('image-file-input').setInputFiles({ name: 'demo.png', mimeType: 'image/png', buffer: PNG_1PX })
  await expect(page.getByTestId('prop-src-value')).toContainText('/api/images/', { timeout: 10_000 })

  // 画布渲染出上传图片
  await expect(page.locator('img[src^="/api/images/"]').first()).toBeVisible({ timeout: 10_000 })
})
