import { expect, test } from '@playwright/test'

/**
 * P1/P2 布局重构验证：活动栏展开收起、面板切换宽度稳定、组件库折叠、画布尺寸、居中。
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

test('P1 活动栏：展开/收起/切换面板，宽度稳定', async ({ page }) => {
  ROOM = 'e2e-' + Math.random().toString(36).slice(2, 10)
  await login(page)

  // 默认属性面板展开
  await expect(page.getByTestId('activity-panel')).toBeVisible()
  const propsWidth = (await page.getByTestId('activity-panel').boundingBox())!.width
  expect(propsWidth).toBeGreaterThan(280) // 面板宽度足够

  // 切换到 AI 面板：宽度不变，内容切换
  await page.getByTestId('activity-ai').click()
  await expect(page.getByTestId('ai-chat-panel')).toBeVisible()
  const aiWidth = (await page.getByTestId('activity-panel').boundingBox())!.width
  expect(Math.abs(aiWidth - propsWidth)).toBeLessThan(2)

  // 再次点击 AI 图标 → 收起
  await page.getByTestId('activity-ai').click()
  await expect(page.getByTestId('activity-panel')).toHaveCount(0)

  // 点击图层 → 展开；关闭按钮 → 收起
  await page.getByTestId('activity-layers').click()
  await expect(page.getByTestId('layer-tree')).toBeVisible()
  await page.getByTestId('panel-close').click()
  await expect(page.getByTestId('activity-panel')).toHaveCount(0)

  // 活动栏图标选中态
  await page.getByTestId('activity-settings').click()
  await expect(page.getByTestId('activity-settings')).toHaveAttribute('data-active', 'true')
  await expect(page.getByTestId('settings-panel')).toBeVisible()
})

test('P2 组件库折叠：宽度缩小 + 图标列 + 画布空间变大', async ({ page }) => {
  ROOM = 'e2e-' + Math.random().toString(36).slice(2, 10)
  await login(page)
  // 重置并等待同步稳定（room 状态在测试间累积）
  ROOM = 'e2e-' + Math.random().toString(36).slice(2, 10)
  await page.goto('/workspace?from=demo&demo=coupon-root&room=' + ROOM)
  await expect(page.getByTestId('node-coupon-title')).toBeVisible()
  const aside = page.locator('aside').first()
  const widthExpanded = (await aside.boundingBox())!.width
  expect(widthExpanded).toBeGreaterThan(150)

  await page.getByTestId('palette-collapse').click()
  await expect(page.getByTestId('component-palette-collapsed')).toBeVisible()
  await page.waitForTimeout(300) // 等待宽度过渡动画
  const widthCollapsed = (await aside.boundingBox())!.width
  expect(widthCollapsed).toBeLessThan(60)

  // 收起态图标存在且可点击添加
  await page.getByTestId('palette-icon-button').click()
  await expect(page.locator('[data-node-id^="button-"]').last()).toBeVisible()

  // 展开恢复
  await page.getByTestId('palette-expand').click()
  await expect(page.getByTestId('component-palette')).toBeVisible()
  await page.waitForTimeout(300) // 等待宽度过渡动画
  expect((await aside.boundingBox())!.width).toBeGreaterThan(150)
})

test('P3 布局切换：容器切 free 后子节点可自由拖动', async ({ page }) => {
  ROOM = 'e2e-' + Math.random().toString(36).slice(2, 10)
  await login(page)
  ROOM = 'e2e-' + Math.random().toString(36).slice(2, 10)
  await page.goto('/workspace?from=demo&demo=coupon-root&room=' + ROOM)
  await expect(page.getByTestId('node-coupon-title')).toBeVisible()

  // 通过图层树精确选中根容器（点击画布中心会命中内部子节点）
  await page.getByTestId('activity-layers').click()
  await page.getByTestId('layer-coupon-root').click()
  await page.getByTestId('activity-props').click()
  await page.getByTestId('prop-layout').selectOption('free')
  await page.waitForTimeout(500)
  // 子节点获得初始化坐标（可拖动）
  await expect(page.getByTestId('node-coupon-title')).toBeVisible()

  // 拖动标题节点 → 位置变化
  const title = page.getByTestId('node-coupon-title')
  const box0 = await title.boundingBox()
  await page.mouse.move(box0.x + box0.width / 2, box0.y + box0.height / 2)
  await page.mouse.down()
  await page.mouse.move(box0.x + box0.width / 2 + 120, box0.y + box0.height / 2 + 60, { steps: 8 })
  await page.mouse.up()
  await page.waitForTimeout(300)
  const box1 = await title.boundingBox()
  expect(Math.abs(box1.x - box0.x)).toBeGreaterThan(60)
})

test('P4 画布尺寸：预设与手动输入实时生效 + 居中', async ({ page }) => {
  ROOM = 'e2e-' + Math.random().toString(36).slice(2, 10)
  await login(page)
  // 点击画布右下角灰色空白 → 取消选中 → 属性面板显示画布设置
  const canvasBox = (await page.getByTestId('design-canvas').boundingBox())!
  await page.mouse.click(canvasBox.x + canvasBox.width - 40, canvasBox.y + canvasBox.height - 40)
  await expect(page.getByTestId('canvas-settings')).toBeVisible()

  // 预设 375（手机）
  await page.getByTestId('canvas-preset-375').click()
  const sheet = page.getByTestId('canvas-sheet')
  const box = await sheet.boundingBox()
  expect(box.width).toBeLessThanOrEqual(380)
  expect(box.height).toBeLessThanOrEqual(680)

  // 手动输入宽度（小于容器宽度，验证居中）
  await page.getByTestId('canvas-width').fill('700')
  await page.waitForTimeout(300)
  const box2 = await sheet.boundingBox()
  expect(box2.width).toBeGreaterThan(680)

  // 画布居中：sheet 中心 ≈ 画布容器中心（水平）
  const canvasBoxNow = await page.getByTestId('design-canvas').boundingBox()
  const centerDiff = Math.abs(box2.x + box2.width / 2 - (canvasBoxNow.x + canvasBoxNow.width / 2))
  expect(centerDiff).toBeLessThan(30)
})

test('P4b 画布尺寸最小限制与自由布局落点拖入', async ({ page }) => {
  ROOM = 'e2e-' + Math.random().toString(36).slice(2, 10)
  await login(page)
  // 页面加载无选中节点 → 属性面板直接显示画布设置
  await expect(page.getByTestId('canvas-settings')).toBeVisible()
  await page.getByTestId('canvas-width').fill('100')
  await page.waitForTimeout(300)
  const sheet = await page.getByTestId('canvas-sheet').boundingBox()
  expect(sheet.width).toBeGreaterThanOrEqual(320) // 最小 320
})
