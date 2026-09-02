import { expect, test } from '@playwright/test'

/** P1-5 图层管理：重命名 / 隐藏 / 展开折叠 / 拖拽排序（拖拽改父级依赖真实拖放，基础路径验证） */

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

async function openLayers(page: import('@playwright/test').Page) {
  await page.getByTestId('activity-layers').click()
  await expect(page.getByTestId('layer-tree')).toBeVisible()
}

test('重命名：双击节点名修改，画布显示自定义名', async ({ page }) => {
  ROOM = 'e2e-' + Math.random().toString(36).slice(2, 10)
  await login(page)
  ROOM = 'e2e-' + Math.random().toString(36).slice(2, 10)
  await page.goto('/workspace?from=demo&demo=coupon-root&room=' + ROOM)
  await expect(page.getByTestId("node-coupon-title")).toBeVisible()
  await openLayers(page)

  // 双击 coupon-title 行 → 输入框
  await page.getByTestId('layer-coupon-title').dblclick()
  const input = page.getByTestId('layer-rename-input-coupon-title')
  await expect(input).toBeVisible()
  await input.fill('618 主标题')
  await input.press('Enter')

  // 图层树显示新名字
  await expect(page.getByTestId('layer-coupon-title')).toContainText('618 主标题')
})

test('隐藏：眼睛图标切换，画布节点消失，数据保留', async ({ page }) => {
  ROOM = 'e2e-' + Math.random().toString(36).slice(2, 10)
  await login(page)
  ROOM = 'e2e-' + Math.random().toString(36).slice(2, 10)
  await page.goto('/workspace?from=demo&demo=coupon-root&room=' + ROOM)
  await expect(page.getByTestId("node-coupon-title")).toBeVisible()
  await openLayers(page)

  await page.getByTestId('layer-hide-coupon-note').click()
  // 画布中节点消失
  await expect(page.getByTestId('node-coupon-note')).toHaveCount(0)
  // 图层树仍在（带隐藏样式）
  await expect(page.getByTestId('layer-coupon-note')).toBeVisible()
  // 取消隐藏恢复
  await page.getByTestId('layer-hide-coupon-note').click()
  await expect(page.getByTestId('node-coupon-note')).toBeVisible()
})

test('展开/折叠：容器箭头切换子节点列表', async ({ page }) => {
  ROOM = 'e2e-' + Math.random().toString(36).slice(2, 10)
  await login(page)
  ROOM = 'e2e-' + Math.random().toString(36).slice(2, 10)
  await page.goto('/workspace?from=demo&demo=coupon-root&room=' + ROOM)
  await expect(page.getByTestId("node-coupon-title")).toBeVisible()
  await openLayers(page)

  // coupon-root 有子节点 → 折叠后 children 隐藏
  await page.getByTestId('layer-toggle-coupon-root').click()
  await expect(page.getByTestId('layer-children-coupon-root')).toHaveCount(0)
  await page.getByTestId('layer-toggle-coupon-root').click()
  await expect(page.getByTestId('layer-children-coupon-root')).toBeVisible()
})

test('拖拽排序（图层树内同级移动）', async ({ page }) => {
  ROOM = 'e2e-' + Math.random().toString(36).slice(2, 10)
  await login(page)
  ROOM = 'e2e-' + Math.random().toString(36).slice(2, 10)
  await page.goto('/workspace?from=demo&demo=free-root&room=' + ROOM)
  await expect(page.getByTestId('node-free-btn-1')).toBeVisible()
  await openLayers(page)

  const orderBefore = await page
    .locator('[data-testid^="layer-free-btn-"]')
    .evaluateAll((els) => els.map((el) => el.getAttribute('data-testid')))
  expect(orderBefore).toEqual(['layer-free-btn-1', 'layer-free-btn-2'])

  // 拖拽 btn-2 到 btn-1 之前
  const source = page.getByTestId('layer-free-btn-2')
  const target = page.getByTestId('layer-free-btn-1')
  const sb = (await source.boundingBox())!
  const tb = (await target.boundingBox())!
  await page.mouse.move(sb.x + sb.width / 2, sb.y + sb.height / 2)
  await page.mouse.down()
  await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2, { steps: 6 })
  await page.mouse.up()

  const orderAfter = await page
    .locator('[data-testid^="layer-free-btn-"]')
    .evaluateAll((els) => els.map((el) => el.getAttribute('data-testid')))
  expect(orderAfter).toEqual(['layer-free-btn-2', 'layer-free-btn-1'])
})
