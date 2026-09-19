/**
 * B+「房间为准」的双浏览器守门（2026-09-17）。
 *
 * 这条是**端到端**守卫：单元测试钉住的是机制（连接前不许 seed），这里钉住用户看到的结果。
 * 需要真实的 y-websocket（本机 1234）：没起容器时本用例会失败，与 presence/room-isolation 那几条一致。
 *
 * 场景：A 打开某房间、改一处**不保存**的编辑 → B（另一个浏览器上下文）打开同一房间 →
 * A 的改动必须在两边都还在（改前：B 会把"从 DB/模板读出来的旧稿"seed 进房间，
 * 约一半概率把 A 的新编辑覆盖回旧值）。
 */
import { expect, test } from '@playwright/test'

async function login(page: import('@playwright/test').Page, url: string) {
  await page.goto(url)
  if (await page.getByTestId('login-password').isVisible().catch(() => false)) {
    await page.getByTestId('login-password').fill('demo123')
    await page.getByTestId('login-submit').click()
  }
  await expect(page.getByTestId('workspace-page')).toBeVisible({ timeout: 15_000 })
}

test('A 的未保存编辑在 B 打开同一房间后必须两边都在（房间为准）', async ({ browser }) => {
  const room = 'e2e-roomfirst-' + Math.random().toString(36).slice(2, 10)
  const url = `/workspace?from=demo&demo=coupon-root&room=${room}`

  const ctxA = await browser.newContext()
  const pageA = await ctxA.newPage()
  await login(pageA, url)
  await expect(pageA.getByTestId('node-coupon-title')).toBeVisible({ timeout: 15_000 })

  // A 改一处文案（不保存）：图层树选中 → 属性面板改写
  await pageA.getByTestId('activity-layers').click()
  await pageA.getByTestId('layer-coupon-title').click()
  await pageA.getByTestId('activity-props').click()
  await pageA.getByTestId('prop-text').fill('A 还没保存的改动')
  await pageA.waitForTimeout(400)
  await expect(pageA.getByTestId('node-coupon-title')).toContainText('A 还没保存的改动')

  // B：另一个浏览器上下文，同一个房间
  const ctxB = await browser.newContext()
  const pageB = await ctxB.newPage()
  await login(pageB, url)

  const textA = await pageA.getByTestId('node-coupon-title').innerText()
  const textB = await pageB.getByTestId('node-coupon-title').innerText()
  // eslint-disable-next-line no-console
  console.log('[房间为准] A 页面文案 =', textA, '｜ B 页面文案 =', textB)
  // eslint-disable-next-line no-console
  console.log('[房间为准] B 上"正在同步"提示数量 =', await pageB.getByTestId('sync-pending-hint').count())

  await expect(pageB.getByTestId('node-coupon-title'), 'B 必须看到 A 的未保存编辑').toContainText(
    'A 还没保存的改动',
    { timeout: 10_000 },
  )
  await expect(pageA.getByTestId('node-coupon-title'), 'A 这边不能被回退').toContainText('A 还没保存的改动')

  await ctxA.close()
  await ctxB.close()
})
