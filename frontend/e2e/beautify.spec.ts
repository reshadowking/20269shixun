import { expect, test, type Page } from '@playwright/test'

/**
 * 缺陷 3 回归：美化阶段（版面确认 → 只加样式效果 → 对比/临时关闭 → 写入层锁版面）。
 * 前置：后端 :8000 + Vite :5173（走 /api/apply-effects；不依赖 y-websocket）。
 */

async function openLoginPageWorkspace(page: Page) {
  const room = 'e2e-' + Math.random().toString(36).slice(2, 10)
  await page.goto(`/workspace?template=login&room=${room}`)
  if (await page.getByTestId('login-password').isVisible().catch(() => false)) {
    await page.getByTestId('login-password').fill('demo123')
    await page.getByTestId('login-submit').click()
  }
  await expect(page.getByTestId('workspace-page')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId('node-login-title').first()).toBeVisible({ timeout: 10_000 })
}

test('美化：版面确认 → 应用效果 → 锁定写入层拒绝改结构 → 对比/临时关闭效果', async ({ page }) => {
  test.setTimeout(120_000)
  await openLoginPageWorkspace(page)

  // 选中标题组件（美化效果作用对象）
  await page.getByTestId('node-login-title').first().click()
  await expect(page.getByTestId('selection-count')).toContainText('已选 1 个节点')

  await page.getByTestId('activity-beautify').click()
  await expect(page.getByTestId('beautify-panel')).toBeVisible()

  // ① 版面确认：保留基础版快照 + 锁定版面
  await expect(page.getByTestId('beautify-confirm')).toBeVisible()
  await page.getByTestId('beautify-confirm').click()
  await expect(page.getByTestId('beautify-confirmed')).toContainText('基础版已保留')
  await expect(page.getByTestId('beautify-lock-note')).toContainText('版面已锁定')

  // ② 应用阴影效果（白名单 → 服务端写入 → 画布真实渲染）
  await page.getByTestId('beautify-shadow-2').click()
  await expect(page.getByTestId('node-login-title')).toHaveAttribute('style', /box-shadow/, { timeout: 10_000 })

  // ③ 应用渐变背景（用于"临时关闭效果"对照的显著特征）
  await page.getByTestId('beautify-backgroundImage-0').click()
  await expect(page.getByTestId('node-login-title')).toHaveAttribute('style', /linear-gradient/, { timeout: 10_000 })

  // ④ 锁定生效：结构类写入被数据层拒绝（组件库加模块 → 不产生新节点 + 明确提示）
  const beforeCount = await page.locator('[data-testid^="node-"]').count()
  await page.getByTestId('palette-button').click()
  await expect(page.getByTestId('beautify-blocked-hint')).toContainText('版面已确认', { timeout: 10_000 })
  await expect(page.locator('[data-testid^="node-"]')).toHaveCount(beforeCount)

  // ⑤ 属性面板同步锁定：布局字段消失、给出锁定说明
  await page.getByTestId('activity-props').click()
  await expect(page.getByTestId('prop-locked-note')).toBeVisible()
  await expect(page.getByTestId('prop-layout')).toHaveCount(0)
  await expect(page.getByTestId('layer-top')).toBeDisabled()

  // ⑥ 对比原始版面：基础版与当前并排
  await page.getByTestId('activity-beautify').click()
  await page.getByTestId('beautify-compare').click()
  await expect(page.getByTestId('beautify-compare-dialog')).toBeVisible()
  await expect(page.getByTestId('beautify-thumb-base')).toBeVisible()
  await expect(page.getByTestId('beautify-thumb-current')).toBeVisible()
  await page.getByTestId('beautify-compare-close').click()

  // ⑦ 临时关闭全部高级效果：画布切到基础版（无渐变），退出后恢复
  await page.getByTestId('beautify-preview-toggle').click()
  await expect(page.getByTestId('base-preview')).toBeVisible()
  await expect(page.locator('[data-testid="base-preview"] [style*="linear-gradient"]')).toHaveCount(0)
  await expect(page.getByTestId('base-preview-banner')).toContainText('高级效果已临时关闭')
  await page.getByTestId('base-preview-exit').click()
  await expect(page.getByTestId('base-preview')).toHaveCount(0)
  await expect(page.getByTestId('node-login-title')).toHaveAttribute('style', /linear-gradient/)

  // ⑧ 尺寸类效果：先二次确认——取消则不生效，确认才写入
  await page.getByTestId('beautify-transform-0').click() // 取消确认
  await expect(page.getByTestId('node-login-title')).not.toHaveAttribute('style', /transform/, { timeout: 3_000 }).catch(() => {})
  await expect(page.getByTestId('node-login-title')).not.toHaveAttribute('style', /scale\(/)

  page.once('dialog', (d) => d.accept())
  await page.getByTestId('beautify-transform-0').click()
  await expect(page.getByTestId('node-login-title')).toHaveAttribute('style', /scale\(1\.04\)/, { timeout: 10_000 })
})
