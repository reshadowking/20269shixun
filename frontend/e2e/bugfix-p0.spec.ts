import { expect, test } from '@playwright/test'

/** P0-1 图层层级方向 / P0-2 圆角绑定（修复验证） */

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

test('P0-1 图层层级：置顶=最上层（children 末尾），置底=最下层（开头）', async ({ page }) => {
  ROOM = 'e2e-' + Math.random().toString(36).slice(2, 10)
  await login(page)
  ROOM = 'e2e-' + Math.random().toString(36).slice(2, 10)
  await page.goto('/workspace?from=demo&demo=free-root&room=' + ROOM)
  await expect(page.getByTestId('node-free-btn-1')).toBeVisible()

  // 通过图层树选中 free-btn-1
  await page.getByTestId('activity-layers').click()
  await page.getByTestId('layer-free-btn-1').click()
  await page.getByTestId('activity-props').click()

  const childrenOrder = async () =>
    page.evaluate(() =>
      Array.from(document.querySelector('[data-testid="canvas-sheet"]')!.querySelectorAll('[data-node-id^="free-"]'))
        .map((el) => el.getAttribute('data-node-id')),
    )

  // 初始顺序：root, title, btn-1, btn-2, card, img（root 占 index 0）
  expect(await childrenOrder()).toEqual(['free-root', 'free-title', 'free-btn-1', 'free-btn-2', 'free-card', 'free-img'])

  // 置顶 → free-btn-1 移到末尾（最后渲染 = 最上层）
  await page.getByTestId('layer-top').click()
  await page.waitForTimeout(300)
  const afterTop = await childrenOrder()
  expect(afterTop[afterTop.length - 1]).toBe('free-btn-1')

  // 置底 → free-btn-1 移到 root 之后（最下层）
  await page.getByTestId('layer-bottom').click()
  await page.waitForTimeout(300)
  const afterBottom = await childrenOrder()
  expect(afterBottom[1]).toBe('free-btn-1')

  // 上移：向"上层"移动一格（btn-1 到 title 之后）
  await page.getByTestId('layer-up').click()
  await page.waitForTimeout(300)
  const afterUp = await childrenOrder()
  expect(afterUp.indexOf('free-btn-1')).toBe(afterUp.indexOf('free-title') + 1)

  // 下移：回 title 之前
  await page.getByTestId('layer-down').click()
  await page.waitForTimeout(300)
  const afterDown = await childrenOrder()
  expect(afterDown[1]).toBe('free-btn-1')
})

test('P0-2 圆角应用到组件本身（按钮内部背景层），选中框 outline 有间隙', async ({ page }) => {
  ROOM = 'e2e-' + Math.random().toString(36).slice(2, 10)
  await login(page)
  ROOM = 'e2e-' + Math.random().toString(36).slice(2, 10)
  await page.goto('/workspace?from=demo&demo=coupon-root&room=' + ROOM)
  await expect(page.getByTestId('node-coupon-1')).toBeVisible()

  // 选中优惠券卡片（按钮组件）
  await page.getByTestId('node-coupon-1').click()
  await page.getByTestId('prop-radius').fill('20')
  await page.waitForTimeout(300)

  // 组件内部 div（CanvasButton 渲染层）有 borderRadius 20
  const btnInner = page.getByTestId('node-coupon-1').locator('div').first()
  const innerStyle = await btnInner.getAttribute('style')
  expect(innerStyle).toMatch(/border-radius: 20px|borderRadius: ?20/)

  // 选中框（outline）带 2px 间隙（outline-offset: 2px）
  const nodeStyle = await page.getByTestId('node-coupon-1').getAttribute('style')
  expect(nodeStyle).toMatch(/outline-offset: 2px|outlineOffset: ?2/)
  expect(nodeStyle).toMatch(/rgba\(0, 82, 217/)
})
