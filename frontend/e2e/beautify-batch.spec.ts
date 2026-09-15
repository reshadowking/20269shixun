import { expect, test, type Page } from '@playwright/test'

/**
 * T4 批3：批量美化 E2E（选中一个卡片 → 应用到同类 → 多节点同时出现预置效果）。
 * 链路：面板范围选择器「同类节点」→ 批量回调 → POST /api/apply-effects/batch（原子生效）
 * → 一次撤销整批回退。前置：后端 :8000 + Vite :5173（不依赖 y-websocket）。
 */

const SHADOW_PRESET = '0px 4px 12px' // 预置「轻」= 0 4px 12px rgba(29,33,41,0.10)

async function openCouponWorkspace(page: Page) {
  const session = `batch-${Math.random().toString(36).slice(2, 8)}`
  await page.goto(`/workspace?session=${session}&from=demo&demo=coupon-root&room=e2e-${session}`)
  if (await page.getByTestId('login-password').isVisible().catch(() => false)) {
    await page.getByTestId('login-password').fill('demo123')
    await page.getByTestId('login-submit').click()
  }
  await expect(page.getByTestId('workspace-page')).toBeVisible({ timeout: 15_000 })
  // 示例稿含 3 个可见按钮（coupon-1/2/3）
  await expect(page.getByTestId('node-coupon-1')).toBeVisible({ timeout: 15_000 })
  return session
}

test('批量美化：应用到同类节点 → 3 个按钮同时出现预置阴影 → 一步撤销全部回退', async ({ page }) => {
  test.setTimeout(120_000)
  await openCouponWorkspace(page)

  // 选中一个按钮（componentType=button 的同类基线）
  await page.getByTestId('node-coupon-1').click()
  await expect(page.getByTestId('selection-count')).toContainText('已选 1 个节点')

  await page.getByTestId('activity-beautify').click()
  await expect(page.getByTestId('beautify-panel')).toBeVisible()

  // 版面确认（锁定后美化，真实使用场景）
  await page.getByTestId('beautify-confirm').click()
  await expect(page.getByTestId('beautify-confirmed')).toBeVisible({ timeout: 15_000 })

  // 切到「同类节点」范围：影响范围 = 3 个可见按钮（隐藏节点若有则排除）
  await page.getByTestId('beautify-scope-same-type').click()
  await expect(page.getByTestId('beautify-batch-note')).toContainText('将应用到 3 个节点')

  // 应用预置「轻」阴影 → 三个按钮同时出现同一预置值
  await page.getByTestId('beautify-shadow-1').click()
  // 先等批量响应落地（第一个节点出现内联阴影），再逐个断言
  await expect(page.getByTestId('node-coupon-1')).toHaveAttribute('style', /box-shadow/, { timeout: 15_000 })
  // 面板无错误反馈（批量被拒会显示 beautify-error）
  await expect(page.getByTestId('beautify-error')).toHaveCount(0)
  for (const id of ['node-coupon-1', 'node-coupon-2', 'node-coupon-3']) {
    const shadow = await page
      .getByTestId(id)
      .evaluate((el) => getComputedStyle(el).boxShadow)
      .catch(() => '')
    expect(shadow, id).toContain(SHADOW_PRESET)
  }

  // 一步撤销：批量走快照式回退（resetDesign 清操作级撤销栈，「撤销优化」= popSnapshot
  // 的共享 AI 版本回退入口，单效果应用/优化同款）；一次恢复整批，无半应用残留
  await page.getByTestId('undo-optimize').click()
  for (const id of ['node-coupon-1', 'node-coupon-2', 'node-coupon-3']) {
    await expect(page.getByTestId(id)).not.toHaveAttribute('style', /box-shadow/, { timeout: 10_000 })
  }
})
