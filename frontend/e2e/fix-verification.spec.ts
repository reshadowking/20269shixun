import { expect, test } from '@playwright/test'

/**
 * 修复验证（说明书 F1-F4）：
 * 自由拖动（free 布局）、flex 重排、平移无白屏、缩放+平移组合。
 * 前置：后端 :8000 + Vite :5173 + y-websocket :1234。
 */

// 每测试唯一协作 room：隔离 y-websocket 状态（避免测试间残留覆盖）
let ROOM = 'e2e-' + Math.random().toString(36).slice(2, 10)

async function login(page: import('@playwright/test').Page) {
  await page.goto('/workspace?room=' + ROOM)
  if (await page.getByTestId('login-password').isVisible().catch(() => false)) {
    await page.getByTestId('login-password').fill('demo123')
    await page.getByTestId('login-submit').click()
  }
  await expect(page.getByTestId('workspace-page')).toBeVisible()
}

test('F2：自由布局示例中节点可自由拖动（free 坐标变化）', async ({ page }) => {
  ROOM = 'e2e-' + Math.random().toString(36).slice(2, 10)
  await login(page)
  // 切换到自由布局示例
  ROOM = 'e2e-' + Math.random().toString(36).slice(2, 10)
  await page.goto('/workspace?from=demo&demo=free-root&room=' + ROOM)
  const btn = page.getByTestId('node-free-btn-1')
  await expect(btn).toBeVisible()

  const box0 = await btn.boundingBox()
  expect(box0).not.toBeNull()
  // 拖动按钮 A（从中心拖到右下 150,80）
  await page.mouse.move(box0!.x + box0!.width / 2, box0!.y + box0!.height / 2)
  await page.mouse.down()
  await page.mouse.move(box0!.x + box0!.width / 2 + 150, box0!.y + box0!.height / 2 + 80, { steps: 8 })
  await page.mouse.up()

  const box1 = await btn.boundingBox()
  expect(box1).not.toBeNull()
  // 节点实际移动（free 模式 x/y 实时更新）
  expect(Math.abs(box1!.x - box0!.x)).toBeGreaterThan(80)
  expect(Math.abs(box1!.y - box0!.y)).toBeGreaterThan(30)
})

test('F1：flex 示例中拖动卡片触发重排', async ({ page }) => {
  ROOM = 'e2e-' + Math.random().toString(36).slice(2, 10)
  await login(page)
  ROOM = 'e2e-' + Math.random().toString(36).slice(2, 10)
  await page.goto('/workspace?from=demo&demo=coupon-root&room=' + ROOM)

  const card1 = page.getByTestId('node-coupon-1')
  const card2 = page.getByTestId('node-coupon-2')
  const card3 = page.getByTestId('node-coupon-3')
  await expect(card1).toBeVisible()
  const box1 = await card1.boundingBox()
  const box3 = await card3.boundingBox()
  expect(box1).not.toBeNull()
  expect(box3).not.toBeNull()

  // 把第一张卡片拖到第三张之后
  await page.mouse.move(box1!.x + box1!.width / 2, box1!.y + box1!.height / 2)
  await page.mouse.down()
  await page.mouse.move(box3!.x + box3!.width / 2, box3!.y + box3!.height / 2, { steps: 10 })
  await page.mouse.up()

  // 重排后：第一张卡片位置右移（落到第三张位置附近）
  const box1After = await card1.boundingBox()
  expect(box1After).not.toBeNull()
  expect(box1After!.x).toBeGreaterThan(box1!.x + 60)
})

test('F3/F4：平移画布无白屏（灰色区域 + 白纸内空白），缩放后仍可平移', async ({ page }) => {
  ROOM = 'e2e-' + Math.random().toString(36).slice(2, 10)
  await login(page)
  ROOM = 'e2e-' + Math.random().toString(36).slice(2, 10)
  await page.goto('/workspace?from=demo&demo=coupon-root&room=' + ROOM)

  const canvas = page.getByTestId('design-canvas')
  const sheet = page.getByTestId('canvas-sheet')
  await expect(canvas).toBeVisible()

  // 1) 灰色区域平移
  const canvasBox = await canvas.boundingBox()
  expect(canvasBox).not.toBeNull()
  await page.mouse.move(canvasBox!.x + canvasBox!.width - 30, canvasBox!.y + canvasBox!.height - 30)
  await page.mouse.down()
  await page.mouse.move(canvasBox!.x + canvasBox!.width - 30 + 120, canvasBox!.y + canvasBox!.height - 30 + 60, { steps: 10 })
  await page.mouse.up()
  // 平移后画布仍在视口内、无白屏（标题节点可见或画布世界存在）
  await expect(canvas).toBeVisible()
  await expect(page.getByTestId('canvas-world')).toBeVisible()

  // 2) 白纸内空白平移（卡片下方空隙）
  const note = page.getByTestId('node-coupon-note')
  const noteBox = await note.boundingBox()
  expect(noteBox).not.toBeNull()
  await page.mouse.move(noteBox!.x + 10, noteBox!.y + noteBox!.height + 20)
  await page.mouse.down()
  await page.mouse.move(noteBox!.x + 10 - 100, noteBox!.y + noteBox!.height + 20 - 50, { steps: 10 })
  await page.mouse.up()
  await expect(canvas).toBeVisible()
  await expect(page.getByTestId('canvas-world')).toBeVisible()

  // 3) 200% 缩放后平移仍正常
  await page.getByTestId('zoom-2').click()
  const sheetBox = await sheet.boundingBox()
  expect(sheetBox).not.toBeNull()
  await page.mouse.move(sheetBox!.x + sheetBox!.width - 20, sheetBox!.y + sheetBox!.height - 20)
  await page.mouse.down()
  await page.mouse.move(sheetBox!.x + sheetBox!.width - 20 + 80, sheetBox!.y + sheetBox!.height - 20 + 40, { steps: 8 })
  await page.mouse.up()
  await expect(canvas).toBeVisible()
  await expect(page.getByTestId('canvas-world')).toBeVisible()
})
