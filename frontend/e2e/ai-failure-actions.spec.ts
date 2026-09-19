/**
 * AI 生成失败后的两个出口（2026-09-18）：`fallback-retry` / `fallback-use-template`。
 *
 * 为什么补：这条是**失败路径**，只有真模型超时/限流时才走到（mock 模式永远不失败），
 * 所以 e2e 里一直没覆盖。可它恰恰是用户被卡住时唯一的两个按钮——重试点了没反应、
 * 或者"使用预置模板"没把稿子放上画布，用户就彻底没路走了。
 * 这里用路由拦截把失败响应造出来（`compliance-report.spec.ts` 已有同类先例）。
 *
 * 前置：后端 :8000（mock）+ Vite :5173（本用例不真调模型，/api/generate 被拦）。
 */
import { expect, test } from '@playwright/test'

const TEMPLATE_DESIGN = {
  id: 'fallback-root',
  type: 'frame',
  style: { layout: 'column', width: 400, padding: 16, background: '#FFFFFF' },
  children: [{ id: 'fallback-title', type: 'text', props: { text: '预置模板标题' }, style: {} }],
}

async function openWorkspace(page: import('@playwright/test').Page, session: string) {
  await page.goto(`/workspace?session=${session}&from=blank`)
  if (await page.getByTestId('login-password').isVisible().catch(() => false)) {
    await page.getByTestId('login-password').fill('demo123')
    await page.getByTestId('login-submit').click()
  }
  await expect(page.getByTestId('workspace-page')).toBeVisible({ timeout: 15_000 })
  await page.getByTestId('activity-ai').click()
  await expect(page.getByTestId('ai-chat-panel')).toBeVisible()
}

test('生成失败 →「重试生成」真的重发并落地；再失败时「使用预置模板」也能落地', async ({ page }) => {
  test.setTimeout(90_000)
  const tag = Math.random().toString(36).slice(2, 8)
  let calls = 0
  await page.route('**/api/generate/questions', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ questions: [] }) }),
  )
  await page.route('**/api/generate', (route) => {
    if (route.request().method() !== 'POST') return route.continue()
    calls += 1
    // 第 1、2 次都"失败"，第 3 次成功——正好用来验重试与模板兜底两条路
    if (calls <= 2) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          design: TEMPLATE_DESIGN,
          template: 'login',
          compliance: 100,
          violations: 0,
          fallback: true,
          error: '模型限流',
        }),
      })
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        design: TEMPLATE_DESIGN,
        template: 'login',
        compliance: 100,
        violations: 0,
        fallback: false,
      }),
    })
  })

  await openWorkspace(page, `s-fb${tag}`)
  await page.getByTestId('chat-input').fill('设计一个登录页面，简洁现代风格')
  await page.getByTestId('chat-send').click()

  // 失败必须**说出来**（不静默降级），并给出两个出口
  await expect(page.getByTestId('chat-msg-assistant-2')).toContainText('AI 生成失败', { timeout: 20_000 })
  await expect(page.getByTestId('fallback-actions')).toBeVisible()
  expect(calls).toBe(1)

  // ① 重试：要真的再发一次请求（第 2 次仍失败）→ 仍然给出口
  await page.getByTestId('fallback-retry').click()
  await expect.poll(() => calls, { timeout: 15_000 }).toBe(2)
  await expect(page.getByTestId('fallback-actions')).toBeVisible()

  // ② 这次用预置模板：稿子必须真的落到画布上
  await page.getByTestId('fallback-use-template').click()
  await expect(page.getByTestId('node-fallback-root')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId('fallback-actions')).toHaveCount(0)
})

test('生成成功（第 2 次）后失败出口消失，画布是模型产物', async ({ page }) => {
  test.setTimeout(90_000)
  const tag = Math.random().toString(36).slice(2, 8)
  let calls = 0
  await page.route('**/api/generate/questions', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ questions: [] }) }),
  )
  await page.route('**/api/generate', (route) => {
    if (route.request().method() !== 'POST') return route.continue()
    calls += 1
    const fallback = calls === 1
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        design: TEMPLATE_DESIGN,
        template: 'login',
        compliance: 100,
        violations: 0,
        fallback,
        error: fallback ? '模型限流' : undefined,
      }),
    })
  })

  await openWorkspace(page, `s-fb2${tag}`)
  await page.getByTestId('chat-input').fill('设计一个登录页面，简洁现代风格')
  await page.getByTestId('chat-send').click()
  await expect(page.getByTestId('fallback-actions')).toBeVisible({ timeout: 20_000 })

  await page.getByTestId('fallback-retry').click()
  await expect(page.getByTestId('fallback-actions')).toHaveCount(0, { timeout: 20_000 })
  await expect(page.getByTestId('node-fallback-root')).toBeVisible()
  // 消息顺序：欢迎 / 用户 / 助手（失败）/ 助手（成功）→ 成功那条是 3 号
  await expect(page.getByTestId('chat-msg-assistant-3')).toContainText('已生成设计稿')
})
