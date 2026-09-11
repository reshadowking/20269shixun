import { expect, test } from '@playwright/test'

/**
 * T4 前置/T4 批1 回归：锁定期 AI 落地闸门（真实浏览器 + 真实后端 mock 链路）。
 *
 * mock 模式（T4 前置后）增量修改产出确定性改写树：
 * - 「给卡片加个阴影」→ 第一个 component 节点 style.shadow = 预置「轻」（闸门放行）；
 * - 「把主标题改成 …」→ 第一个 text 节点 props.text 改写（锁定态闸门拒绝，文案变更）。
 *
 * 三条链路：锁定+加阴影=通过 / 锁定+改文案=拒绝（画布不变+可读提示） / 未锁定+改文案=落地。
 * 前置：后端 :8000 + Vite :5173 + y-websocket :1234。
 */

const ORIGINAL_SUB_TEXT = '满减优惠券，先到先得，每人限领 3 张'
const MOCK_EDIT_TEXT = '已按你的要求修改文案（演示模式）'

let RUN = 'gate-' + Math.random().toString(36).slice(2, 8)

async function openWorkspace(page: import('@playwright/test').Page, session: string) {
  await page.goto(`/workspace?session=${session}&from=demo&demo=coupon-root&room=e2e-${session}`)
  if (await page.getByTestId('login-password').isVisible().catch(() => false)) {
    await page.getByTestId('login-password').fill('demo123')
    await page.getByTestId('login-submit').click()
  }
  await expect(page.getByTestId('workspace-page')).toBeVisible({ timeout: 15_000 })
  // 画布加载完成：示例稿节点可见
  await expect(page.getByTestId('node-coupon-sub')).toHaveText(ORIGINAL_SUB_TEXT, { timeout: 15_000 })
}

async function confirmLayout(page: import('@playwright/test').Page) {
  await page.getByTestId('activity-beautify').click()
  await expect(page.getByTestId('beautify-panel')).toBeVisible()
  await page.getByTestId('beautify-confirm').click()
  await expect(page.getByTestId('beautify-confirmed')).toBeVisible({ timeout: 15_000 })
  await page.getByTestId('activity-ai').click()
  await expect(page.getByTestId('chat-input')).toBeVisible()
}

async function chat(page: import('@playwright/test').Page, text: string) {
  await page.getByTestId('chat-input').fill(text)
  await page.getByTestId('chat-send').click()
}

test('锁定态：AI 加阴影 → 闸门通过，画布节点出现预置 box-shadow', async ({ page }) => {
  test.setTimeout(120_000)
  const session = `s-${RUN}-shadow`
  await openWorkspace(page, session)
  await confirmLayout(page)

  await chat(page, '给卡片加个阴影')
  await expect(page.getByText(/已应用修改 ✓/)).toBeVisible({ timeout: 20_000 })

  // 画布第一个 component（coupon-title）出现内联 box-shadow，且为预置「轻」的量级。
  // 落地后 5s 内变更节点带琥珀色高亮环（会盖住 box-shadow 的计算值），等它消退再断言。
  await page.waitForFunction(
    () =>
      (getComputedStyle(document.querySelector('[data-testid="node-coupon-title"]') as Element).boxShadow || '').includes(
        '0px 4px 12px',
      ),
    { timeout: 12_000 },
  )
  const shadow = await page.getByTestId('node-coupon-title').evaluate((el) => getComputedStyle(el).boxShadow)
  expect(shadow).toContain('0px 4px 12px')
  expect(shadow).toContain('rgba(29, 33, 41, 0.1)')
  // 闸门放行后文案未被误改
  await expect(page.getByTestId('node-coupon-sub')).toHaveText(ORIGINAL_SUB_TEXT)
})

test('锁定态：AI 改文案 → 闸门拒绝，画布文案不变 + 可读提示', async ({ page }) => {
  test.setTimeout(120_000)
  const session = `s-${RUN}-reject`
  await openWorkspace(page, session)
  await confirmLayout(page)

  await chat(page, '把主标题改成 E2E 演示文案')
  await expect(page.getByText(/版面锁拒绝/)).toBeVisible({ timeout: 20_000 })
  await expect(page.getByText(/已阻止/)).toBeVisible() // 工作台横幅（同源提示）

  // 画布文案保持原样，AI 的改写未落地
  await expect(page.getByTestId('node-coupon-sub')).toHaveText(ORIGINAL_SUB_TEXT)
  await expect(page.getByText(MOCK_EDIT_TEXT)).toHaveCount(0)
})

test('未锁定：AI 改文案 → 正常落地（对照组）', async ({ page }) => {
  test.setTimeout(120_000)
  const session = `s-${RUN}-open`
  await openWorkspace(page, session)

  await page.getByTestId('activity-ai').click()
  await expect(page.getByTestId('chat-input')).toBeVisible()
  await chat(page, '把主标题改成 E2E 演示文案')
  await expect(page.getByText(/已应用修改 ✓/)).toBeVisible({ timeout: 20_000 })

  // 未锁定：AI 的改写直接落地
  await expect(page.getByTestId('node-coupon-sub')).toHaveText(MOCK_EDIT_TEXT, { timeout: 15_000 })
})
