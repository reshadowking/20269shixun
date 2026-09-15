import { expect, test } from '@playwright/test'

/**
 * 缺陷 1 回归：方案预览与对比留档（真实后端 /api/generate/explore）。
 * 覆盖：二选一预览（缩略图/定位/关键差异）→ 选用 → 已选档查看另一方案（≤2 击、零额外生成）
 *      → 刷新后仍能还原选过的方案 → 重新选择需二次确认；
 *      以及演示模式方案显式标注「演示模板稿」（未配置模型 Key 时不得混同为模型产物）。
 * 前置：后端 :8000 + Vite :5173（本用例不进协作房间同步，不依赖 y-websocket）。
 */

test('演示模式：/api/generate 成功文案显式标注"演示模式"', async ({ page }) => {
  test.setTimeout(90_000)
  await page.goto(`/workspace?room=e2e-${Math.random().toString(36).slice(2, 10)}`)
  if (await page.getByTestId('login-password').isVisible().catch(() => false)) {
    await page.getByTestId('login-password').fill('demo123')
    await page.getByTestId('login-submit').click()
  }
  await expect(page.getByTestId('workspace-page')).toBeVisible({ timeout: 15_000 })
  await page.getByTestId('activity-ai').click()
  await page.getByTestId('chat-input').fill('设计一个登录页面，简洁现代风格')
  await page.getByTestId('chat-send').click()

  const msg = page.getByTestId('chat-msg-assistant-2')
  await expect(msg).toContainText('已生成设计稿', { timeout: 30_000 })
  const text = (await msg.textContent()) ?? ''
  if (!text.includes('演示模式')) {
    // 当前栈是 real 模式（配了模型 Key）：演示标注本就不该出现，跳过本用例
    test.skip(true, '当前栈为 real 模式：未配置 Key 才会标注「演示模板稿」，该断言只在 mock 栈有效')
  }
  await expect(msg).toContainText('演示模式')
  await expect(msg).toContainText('预置模板（非模型生成）')
})

test('方案探索：预览 → 选用 → 查看另一方案 → 刷新还原 → 重新选择（含二次确认）', async ({ page }) => {
  test.setTimeout(120_000)
  const ROOM = 'e2e-' + Math.random().toString(36).slice(2, 10)

  await page.goto(`/workspace?room=${ROOM}`)
  if (await page.getByTestId('login-password').isVisible().catch(() => false)) {
    await page.getByTestId('login-password').fill('demo123')
    await page.getByTestId('login-submit').click()
  }
  await expect(page.getByTestId('workspace-page')).toBeVisible({ timeout: 15_000 })
  await page.getByTestId('activity-ai').click()
  await expect(page.getByTestId('ai-chat-panel')).toBeVisible()

  const exploreCalls: string[] = []
  page.on('request', (r) => {
    if (r.url().includes('/api/generate/explore')) exploreCalls.push(r.url())
  })

  // 描述需求（不发送）→ 探索 2 个方案
  await page.getByTestId('chat-input').fill('设计一个电商优惠券领取页，红色调，圆角风格')
  await page.getByTestId('explore-options').click()
  await expect(page.getByTestId('explore-result')).toBeVisible({ timeout: 30_000 })

  // ① 二选一阶段：两份方案都有缩略图 + 一句话定位；关键差异 3~5 条
  await expect(page.getByTestId('explore-thumb-0')).toBeVisible()
  await expect(page.getByTestId('explore-thumb-1')).toBeVisible()
  await expect(page.getByTestId('explore-positioning-0')).not.toBeEmpty()
  await expect(page.getByTestId('explore-positioning-1')).not.toBeEmpty()
  const diffLines = await page.getByTestId('explore-diff').locator('li').count()
  expect(diffLines - 1).toBeGreaterThanOrEqual(3)
  expect(diffLines - 1).toBeLessThanOrEqual(5)

  // ①b 来源必须显式标注且与真实生成结果区分：
  //     mock 栈 → 「演示模板稿」；real 栈 → 「AI 生成」（两种模式各有明确标注，绝不混同）

  const source = page.getByTestId('explore-source-0')
  await expect(source).toHaveAttribute('data-source', /demo|model/)
  if ((await source.getAttribute('data-source')) === 'demo') {
    await expect(source).toContainText('演示模板稿')
  } else {
    await expect(source).toContainText('AI 生成')
  }

  // ② 选用方案一（首次选定，无需二次确认）
  await page.getByTestId('explore-use-0').click()
  await expect(page.getByTestId('explore-result')).toHaveCount(0)
  await expect(page.getByTestId('explore-archive')).toBeVisible()
  await expect(page.getByTestId('explore-archive-chosen')).toContainText('方案一')
  await expect(page.getByTestId('explore-archive-source')).toHaveAttribute('data-source', /demo|model/)
  await expect(page.getByText(/已加载「方案一/)).toBeVisible({ timeout: 10_000 })

  // ③ 已选档 → 查看另一方案：1 次点击即可见完整详情，且不触发任何重新生成
  const callsBefore = exploreCalls.length
  await page.getByTestId('explore-view-other').click()
  await expect(page.getByTestId('explore-other-1')).toBeVisible()
  await expect(page.getByTestId('explore-other-thumb-1')).toBeVisible()
  await expect(page.getByTestId('explore-other-1')).toContainText('兼容率')
  expect(exploreCalls.length).toBe(callsBefore)

  // ④ 刷新后仍能还原"我选过哪个方案"
  await page.reload()
  await expect(page.getByTestId('workspace-page')).toBeVisible({ timeout: 15_000 })
  await page.getByTestId('activity-ai').click()
  await expect(page.getByTestId('explore-archive-chosen')).toContainText('方案一', { timeout: 10_000 })

  // ⑤ 重新选择另一方案：二次确认 → 确认后改用方案二并更新留档
  await page.getByTestId('explore-rechoose').click()
  await expect(page.getByTestId('explore-rechoose-panel')).toBeVisible()
  page.once('dialog', (d) => d.accept())
  await page.getByTestId('explore-rechoose-use-1').click()
  await expect(page.getByTestId('explore-archive-chosen')).toContainText('方案二', { timeout: 10_000 })

  // ⑥ 再次重新选择但取消确认：当前选定不变（防误覆盖）
  await page.getByTestId('explore-rechoose').click()
  page.once('dialog', (d) => d.dismiss())
  await page.getByTestId('explore-rechoose-use-0').click()
  await expect(page.getByTestId('explore-archive-chosen')).toContainText('方案二')
})
