/**
 * 追问（Q1–Q5）主流程的端到端覆盖（2026-09-18）。
 *
 * 此前 `followup-*` 这组 testid 在 e2e 里**零引用**：谁都没验过"答完问题到底会不会真的生成"。
 * 而这是最常见的一条路——用户只说"设计一个电商优惠券领取页"（没给风格），
 * 助手先问一句，用户点一个选项，才轮得到生成。中途任何一环断掉（答案没合并进 prompt、
 * 答完不触发 runGenerate、问题索引不前进…）用户看到的就是"我答了，然后没反应"。
 *
 * 前置：后端 :8000（mock，mock 会确定性返回追问）+ Vite :5173。
 */
import { expect, test } from '@playwright/test'

test('追问：答完问题后真的生成设计稿（不是答了没反应）', async ({ page }) => {
  test.setTimeout(120_000)
  const tag = Math.random().toString(36).slice(2, 8)

  await page.goto(`/workspace?session=s-fq${tag}&from=blank`)
  if (await page.getByTestId('login-password').isVisible().catch(() => false)) {
    await page.getByTestId('login-password').fill('demo123')
    await page.getByTestId('login-submit').click()
  }
  await expect(page.getByTestId('workspace-page')).toBeVisible({ timeout: 15_000 })

  await page.getByTestId('activity-ai').click()
  await expect(page.getByTestId('ai-chat-panel')).toBeVisible()
  // 刻意不给风格 → 走追问
  await page.getByTestId('chat-input').fill('设计一个电商优惠券领取页')
  await page.getByTestId('chat-send').click()

  const card = page.getByTestId('followup-card')
  await expect(card).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId('followup-question')).not.toBeEmpty()

  // 逐个作答（mock 可能给多问一题），每题点第一个选项
  for (let i = 0; i < 5; i++) {
    const options = card.locator('[data-testid^="followup-option-"]')
    await expect(options.first()).toBeVisible({ timeout: 10_000 })
    await options.first().click()
    // 答完最后一题卡片会消失，否则换下一题
    if ((await card.count()) === 0) break
    await page.waitForTimeout(200)
  }
  await expect(card).toHaveCount(0)

  // 关键：答完之后必须真的出稿（用户名下的消息也还在）
  await expect(page.getByTestId('chat-msg-user-1')).toContainText('设计一个电商优惠券领取页')
  await expect(page.getByTestId('chat-msg-assistant-2')).toContainText('已生成设计稿', { timeout: 30_000 })
  await expect(page.getByTestId('node-ecommerce-root')).toBeVisible({ timeout: 20_000 })
})

test('追问：点「跳过追问，直接生成」也能出稿', async ({ page }) => {
  test.setTimeout(120_000)
  const tag = Math.random().toString(36).slice(2, 8)

  await page.goto(`/workspace?session=s-fq2${tag}&from=blank`)
  if (await page.getByTestId('login-password').isVisible().catch(() => false)) {
    await page.getByTestId('login-password').fill('demo123')
    await page.getByTestId('login-submit').click()
  }
  await expect(page.getByTestId('workspace-page')).toBeVisible({ timeout: 15_000 })
  await page.getByTestId('activity-ai').click()
  await page.getByTestId('chat-input').fill('设计一个电商优惠券领取页')
  await page.getByTestId('chat-send').click()

  await expect(page.getByTestId('followup-card')).toBeVisible({ timeout: 15_000 })
  await page.getByTestId('followup-skip').click()
  await expect(page.getByTestId('followup-card')).toHaveCount(0)
  await expect(page.getByTestId('node-ecommerce-root')).toBeVisible({ timeout: 30_000 })
})
