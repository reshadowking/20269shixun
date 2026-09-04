import { expect, test } from '@playwright/test'

/**
 * D1 回归：合规逐项报告 UI（B2-2 violations_detail → 逐项展示/还原/全部接受）。
 * 用 page.route mock /api/generate 返回带违规明细的响应（真实 LLM 不产违规，无法自然触发）。
 * 前置：后端 uvicorn :8000 + Vite dev :5173 + y-websocket :1234。
 */

const MOCK_DESIGN = {
  id: 'root',
  type: 'frame',
  style: { layout: 'column', padding: 24, background: 'background', width: 500, gap: 8 },
  children: [
    {
      id: 'btn-c1',
      type: 'component',
      componentType: 'button',
      props: { text: '还原测试按钮', variant: 'primary' },
      style: { width: 160, height: 44, background: 'primary', color: '#FFFFFF' },
    },
  ],
}

test('合规逐项报告：展示明细 → 还原此项改回原色 → 全部接受关闭', async ({ page }) => {
  test.setTimeout(90_000)
  const ROOM = 'e2e-' + Math.random().toString(36).slice(2, 10)

  await page.route('**/api/generate/questions', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ questions: [] }) }),
  )
  await page.route('**/api/generate', (route) => {
    if (route.request().method() !== 'POST') return route.continue()
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        design: MOCK_DESIGN,
        template: 'login',
        compliance: 50,
        violations: 2,
        fallback: false,
        violations_detail: [
          { node_id: 'btn-c1', field: 'background', original: '#123456', corrected: 'primary' },
          { node_id: 'btn-c1', field: 'color', original: '#ABCDEF', corrected: 'text-primary' },
        ],
      }),
    })
  })

  await page.goto(`/workspace?room=${ROOM}`)
  if (await page.getByTestId('login-password').isVisible().catch(() => false)) {
    await page.getByTestId('login-password').fill('demo123')
    await page.getByTestId('login-submit').click()
  }
  await expect(page.getByTestId('workspace-page')).toBeVisible({ timeout: 15_000 })

  await page.getByTestId('activity-ai').click()
  await expect(page.getByTestId('ai-chat-panel')).toBeVisible()
  await page.getByTestId('chat-input').fill('设计一个测试页面')
  await page.getByTestId('chat-send').click()

  // 逐项报告出现（两项违规明细原文可见）
  await expect(page.getByTestId('compliance-report')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId('compliance-fix-0')).toContainText('#123456')
  await expect(page.getByTestId('compliance-fix-1')).toContainText('#ABCDEF')

  // 还原第一项（background）：该项从报告消失，另一项保留
  await page.getByTestId('compliance-restore-0').click()
  await expect(page.getByTestId('compliance-fix-0')).not.toContainText('#123456')
  await expect(page.getByTestId('compliance-report')).toContainText('#ABCDEF')

  // 画布上该节点背景改回原违规色 #123456（Yjs 单事务写入）
  const btn = page.getByTestId('node-btn-c1')
  await expect(btn).toBeVisible()
  await expect
    .poll(() => btn.evaluate((el) => getComputedStyle(el).backgroundColor), { timeout: 10_000 })
    .toBe('rgb(18, 52, 86)') // #123456

  // 全部接受：报告关闭
  await page.getByTestId('compliance-accept-all').click()
  await expect(page.getByTestId('compliance-report')).toHaveCount(0)
})
