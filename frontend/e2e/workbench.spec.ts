import { expect, test } from '@playwright/test'

/**
 * 阶段 2 工作台 E2E：组件面板添加 → 属性编辑 → 对齐/分布 → 双标签页 Yjs 协作同步。
 * 前置：后端 uvicorn :8000 + Vite dev :5173 + y-websocket :1234 已启动。
 */

// 每测试唯一协作 room：隔离 y-websocket 状态（避免测试间残留覆盖）
let ROOM = 'e2e-' + Math.random().toString(36).slice(2, 10)

async function login(page: import('@playwright/test').Page) {
  // 同 context 多标签页共享 localStorage：已登录则直接进工作台
  await page.goto('/workspace?room=' + ROOM)
  if (await page.getByTestId('login-password').isVisible().catch(() => false)) {
    await page.getByTestId('login-password').fill('demo123')
    await page.getByTestId('login-submit').click()
  }
  await expect(page.getByTestId('workspace-page')).toBeVisible()
}

/** 重置文档到示例稿（y-websocket room 状态在测试间累积，必须先重置） */
async function resetDesign(page: import('@playwright/test').Page) {
  await page.goto('/workspace?from=demo&demo=coupon-root&room=' + ROOM)
  await expect(page.getByTestId('node-coupon-title')).toBeVisible()
}

test('组件面板添加 → 属性编辑 → 对齐', async ({ page }) => {
  ROOM = 'e2e-' + Math.random().toString(36).slice(2, 10)
  await login(page)
  await resetDesign(page)

  // 1) 从组件面板添加按钮组件
  await page.getByTestId('palette-button').click()
  // 新按钮出现在画布（id 以 button- 开头，通过 data-node-id 前缀匹配）
  const newButton = page.locator('[data-node-id^="button-"]').last()
  await expect(newButton).toBeVisible()
  await expect(newButton).toContainText('按钮')

  // 2) 选中它并修改属性（属性面板 → 文本）
  await newButton.click()
  const textInput = page.getByTestId('prop-text')
  await expect(textInput).toBeVisible()
  await textInput.fill('立即领取')
  await expect(newButton).toContainText('立即领取')

  // 3) 修改样式字号
  const fontSize = page.getByTestId('prop-fontSize')
  await fontSize.fill('20')
  // 画布内联样式生效（fontSize 20px）
  await expect(newButton.locator('div').first()).toHaveAttribute('style', /font-size: 20px|fontSize: ?20/)

  // 3.5) 背景色：改底色 → 画布渲染生效；非令牌色给出令牌建议提示（v2.2 §4.6）
  const bgInput = page.getByTestId('prop-background')
  await expect(bgInput).toBeVisible()
  await bgInput.fill('#FF6B6B')
  await expect(newButton.locator('div').first()).toHaveAttribute('style', /background/)
  // 白名单色（#FF6B6B 在 allowed_hex_colors）不提示
  await expect(page.getByTestId('hint-background')).toHaveCount(0)
  await bgInput.fill('#123456')
  await expect(page.getByTestId('hint-background')).toContainText('非令牌色')

  // 4) 多选对齐：Ctrl+点击两个优惠券卡片 → 顶对齐（flex 父容器 alignItems）
  const card1 = page.getByTestId('node-coupon-1')
  const card2 = page.getByTestId('node-coupon-2')
  await card1.click()
  await card2.click({ modifiers: ['Control'] })
  await expect(page.getByTestId('selection-count')).toContainText('已选 2 个节点')
  await page.getByTestId('align-top').click()
  // coupon-row 的 alignItems 更新（flex 模式）
  const row = page.getByTestId('node-coupon-row')
  await expect(row).toHaveAttribute('style', /align-items: flex-start|alignItems: ?flex-start/)

  // 5) 删除新按钮（属性面板删除按钮）
  await newButton.click()
  await page.getByTestId('prop-delete').click()
  await expect(newButton).toHaveCount(0)
})

test('双标签页 Yjs 实时同步', async ({ context }) => {
  const pageA = await context.newPage()
  const pageB = await context.newPage()
  await login(pageA)
  await resetDesign(pageA)
  await login(pageB)

  // B 同步到 A 的重置后设计（demo 标题可见）
  await expect(pageB.getByTestId('node-coupon-title')).toBeVisible()

  // A 添加一个组件 → B 实时出现
  await pageA.getByTestId('palette-tag').click()
  const tagInB = pageB.locator('[data-node-id^="tag-"]').last()
  await expect(tagInB).toBeVisible({ timeout: 8000 })

  // A 删除节点 → B 同步消失
  const noteInA = pageA.getByTestId('node-coupon-note')
  const noteInB = pageB.getByTestId('node-coupon-note')
  await noteInA.click()
  await pageA.keyboard.press('Delete')
  await expect(noteInB).toHaveCount(0, { timeout: 8000 })
  await expect(noteInA).toHaveCount(0)
})

test('T6：常驻「代码」面板展示当前设计的 src/App.tsx', async ({ page }) => {
  ROOM = 'e2e-' + Math.random().toString(36).slice(2, 10)
  await login(page)
  await resetDesign(page)

  // 第 7 个活动入口：切到代码面板
  await page.getByTestId('activity-code').click()
  await expect(page.getByTestId('code-viewer')).toBeVisible()
  await expect(page.getByTestId('code-filename')).toHaveText('src/App.tsx')
  // 产物是当前设计的 TSX：含 React 组件导出与示例稿真实文本
  const code = await page.getByTestId('code-body').innerText()
  expect(code).toContain('export default function App')
  expect(code).toContain('满减优惠券，先到先得，每人限领 3 张')
})
