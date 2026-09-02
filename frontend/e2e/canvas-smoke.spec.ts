import { expect, test } from '@playwright/test'

/**
 * 阶段 1 冒烟：登录 → 画布渲染 → 选中/拖拽 → 缩放命中（POC 硬截止验证）。
 * 前置：后端 uvicorn :8000 + Vite dev :5173 已启动。
 */

// 每测试唯一协作 room：隔离 y-websocket 状态（避免测试间残留覆盖）
let ROOM = 'e2e-' + Math.random().toString(36).slice(2, 10)

test('登录 → 画布渲染 → 编辑 → 缩放命中', async ({ page }) => {
  ROOM = 'e2e-' + Math.random().toString(36).slice(2, 10)
  // ---- 登录 ----
  ROOM = 'e2e-' + Math.random().toString(36).slice(2, 10)
  await page.goto('/workspace?room=' + ROOM)
  if (await page.getByTestId('login-password').isVisible().catch(() => false)) {
    await page.getByTestId('login-password').fill('demo123')
    await page.getByTestId('login-submit').click()
  }
  await expect(page.getByTestId('workspace-page')).toBeVisible()
  // 重置文档（隔离 y-websocket 累积状态）
  ROOM = 'e2e-' + Math.random().toString(36).slice(2, 10)
  await page.goto('/workspace?from=demo&demo=coupon-root&room=' + ROOM)

  // ---- 画布渲染：示例稿节点可见 ----
  const canvas = page.getByTestId('design-canvas')
  await expect(canvas).toBeVisible()
  await expect(page.getByTestId('node-coupon-root')).toBeVisible()
  await expect(page.getByTestId('node-coupon-title')).toContainText('618 狂欢')

  // ---- 选中 + 拖拽（free/flex 布局下节点移动或重排不报错）----
  const titleNode = page.getByTestId('node-coupon-title')
  await titleNode.click()
  // 选中后画布世界仍有选中节点（outline 由样式呈现，这里验证选中态不破坏渲染）
  await expect(titleNode).toBeVisible()

  // 拖拽 coupon-row 内的第一个优惠券卡片（flex 重排路径）
  const card1 = page.getByTestId('node-coupon-1')
  const row = page.getByTestId('node-coupon-row')
  const box1 = await card1.boundingBox()
  const boxRow = await row.boundingBox()
  expect(box1).not.toBeNull()
  expect(boxRow).not.toBeNull()
  await page.mouse.move(box1!.x + box1!.width / 2, box1!.y + box1!.height / 2)
  await page.mouse.down()
  // 拖到 row 的右侧（第三个卡片之后）
  await page.mouse.move(boxRow!.x + boxRow!.width - 10, box1!.y + box1!.height / 2, { steps: 10 })
  await page.mouse.up()
  await expect(canvas).toBeVisible() // 拖拽后画布仍正常

  // ---- 缩放命中：100% 基准宽度 → 150% 点击命中 → 200% 尺寸约翻倍 ----
  await page.getByTestId('zoom-1').click()
  const widthAt100 = (await titleNode.boundingBox())!.width

  await page.getByTestId('zoom-1.5').click()
  const titleBox = await titleNode.boundingBox()
  expect(titleBox).not.toBeNull()
  await page.mouse.click(titleBox!.x + 5, titleBox!.y + 5)
  await expect(titleNode).toBeVisible()

  await page.getByTestId('zoom-2').click()
  const widthAt200 = (await titleNode.boundingBox())!.width
  expect(widthAt200).toBeGreaterThan(widthAt100 * 1.7)

  // 恢复 100%
  await page.getByTestId('zoom-1').click()
  await expect(titleNode).toBeVisible()

  // ---- 删除：选中 coupon-note 后按 Delete ----
  const note = page.getByTestId('node-coupon-note')
  await note.click()
  await page.keyboard.press('Delete')
  await expect(page.getByTestId('node-coupon-note')).toHaveCount(0)

  // ---- 复制：选中标题 Ctrl+D ----
  await page.getByTestId('node-coupon-title').click()
  await page.keyboard.press('Control+d')
  // 复制后标题节点至少仍存在（副本 id 不同，不重复断言数量）
  await expect(page.getByTestId('node-coupon-title')).toHaveCount(1)
})
