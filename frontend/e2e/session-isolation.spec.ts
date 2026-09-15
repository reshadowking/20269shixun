import { expect, test, type Page } from '@playwright/test'

/**
 * 缺陷 4 回归：画布会话隔离（消息/Agent 状态按 sessionId 存取，切换/清空互不影响）+ 4b 快照与防误删。
 * 前置：后端 :8000 + Vite :5173（走 /api/sessions；不依赖 y-websocket 同步）。
 */

/** 真实消息（排除欢迎语气泡：欢迎语自带示例文案，会干扰"是否串会话"的断言） */
function realMessages(page: Page) {
  return page.locator('[data-testid^="chat-msg-"]:not([data-testid="chat-msg-assistant-0"])')
}

async function login(page: Page) {
  if (await page.getByTestId('login-password').isVisible().catch(() => false)) {
    await page.getByTestId('login-password').fill('demo123')
    await page.getByTestId('login-submit').click()
  }
  await expect(page.getByTestId('workspace-page')).toBeVisible({ timeout: 15_000 })
}

async function sendChat(page: Page, text: string, expectReply: RegExp) {
  await page.getByTestId('chat-input').fill(text)
  await page.getByTestId('chat-send').click()
  await expect(page.getByTestId('chat-msg-assistant-2')).toContainText(expectReply, { timeout: 30_000 })
}

test('会话隔离：新建空会话不继承历史、切换只加载本会话、清空 A 不影响 B', async ({ page }) => {
  test.setTimeout(150_000)
  const room = 'e2e-' + Math.random().toString(36).slice(2, 10)
  await page.goto(`/workspace?template=login&room=${room}`)
  await login(page)

  // 会话身份写回 URL（刷新/分享稳定）
  await expect(page).toHaveURL(new RegExp('session=s-'))
  const keyA = new URL(page.url()).searchParams.get('session')!

  // 会话 A：发一条消息（落到服务端会话）；会话栏在 AI 面板内
  await page.getByTestId('activity-ai').click()
  await expect(page.getByTestId('ai-chat-panel')).toBeVisible()
  await expect(page.getByTestId('session-key')).toHaveText(keyA)
  await sendChat(page, '设计一个电商优惠券领取页，红色调', /已生成设计稿/)

  // 新建会话：全新 sessionId + 空会话（不继承 A 的任何历史）
  await page.getByTestId('session-new').click()
  await expect(page).toHaveURL(/from=blank/)
  const keyB = new URL(page.url()).searchParams.get('session')!
  expect(keyB).not.toBe(keyA)
  await page.getByTestId('activity-ai').click()
  await expect(page.getByTestId('session-key')).toHaveText(keyB)
  await expect(page.getByTestId('chat-msg-assistant-0')).toHaveText(/你好！我是 AI 设计助手/)
  expect(await realMessages(page).count()).toBe(0) // 只有欢迎语，无任何历史消息

  // 会话 B：各自对话互不可见
  await sendChat(page, '设计一个简洁的登录页面', /已生成设计稿/)
  await page.getByTestId('session-current').click()
  await page.getByTestId('session-item-' + keyA).click()
  // 切换会话 = 换 URL → 工作台整体重挂载（面板回到默认），所以先开 AI 面板再断言
  await expect(page).toHaveURL(new RegExp('session=' + keyA), { timeout: 15_000 })
  await page.getByTestId('activity-ai').click()
  await expect(page.getByTestId('session-key')).toHaveText(keyA, { timeout: 15_000 })
  // A 自己的消息在（用户 + 回复 = 2 条），B 的消息一条都没有
  await expect(page.getByTestId('chat-msg-user-1')).toContainText('优惠券领取页', { timeout: 15_000 })
  await expect(realMessages(page)).toHaveCount(2)
  await expect(realMessages(page).filter({ hasText: '简洁的登录页面' })).toHaveCount(0)

  // 清空会话 A（二次确认）→ A 空，B 完好
  page.once('dialog', (d) => d.accept())
  await page.getByTestId('chat-clear-history').click()
  await expect(page.getByTestId('chat-msg-assistant-0')).toHaveText(/你好！我是 AI 设计助手/)
  await expect(realMessages(page)).toHaveCount(0) // 只剩欢迎语

  await page.getByTestId('session-current').click()
  await page.getByTestId('session-item-' + keyB).click()
  await expect(page).toHaveURL(new RegExp('session=' + keyB), { timeout: 15_000 })
  await page.getByTestId('activity-ai').click()
  await expect(page.getByTestId('session-key')).toHaveText(keyB, { timeout: 15_000 })
  await expect(page.getByTestId('chat-msg-user-1')).toContainText('简洁的登录页面', { timeout: 15_000 })
  await expect(realMessages(page)).toHaveCount(2)
  await expect(realMessages(page).filter({ hasText: '优惠券领取页' })).toHaveCount(0)

  // 删除会话（二次确认）→ 列表里消失
  page.once('dialog', (d) => d.accept())
  await page.getByTestId('session-current').click()
  await page.getByTestId('session-delete-' + keyB).click()
  await page.waitForTimeout(500) // 删除后当前会话被删除 → 跳新会话
  await page.getByTestId('activity-ai').click()
  await page.getByTestId('session-current').click()
  await expect(page.getByTestId('session-item-' + keyB)).toHaveCount(0)
})

test('会话快照：保存 → 改画布 → 回退（二次确认）→ 画布还原', async ({ page }) => {
  test.setTimeout(150_000)
  const room = 'e2e-' + Math.random().toString(36).slice(2, 10)
  await page.goto(`/workspace?template=login&room=${room}`)
  await login(page)
  await expect(page.getByTestId('node-login-title').first()).toBeVisible({ timeout: 10_000 })
  await page.getByTestId('activity-ai').click()

  // 保存快照（基础版）
  await page.getByTestId('session-snapshots-toggle').click()
  await page.getByTestId('snapshot-label').fill('基础版')
  await page.getByTestId('snapshot-save').click()
  await expect(page.getByTestId('snapshot-list')).toContainText('基础版')

  // 改画布：给标题加阴影效果
  await page.getByTestId('node-login-title').first().click()
  await page.getByTestId('activity-beautify').click()
  await page.getByTestId('beautify-shadow-2').click()
  await expect(page.getByTestId('node-login-title')).toHaveAttribute('style', /box-shadow/, { timeout: 10_000 })

  // 回退快照：取消确认 → 不还原；确认 → 还原（阴影消失）
  await page.getByTestId('activity-ai').click()
  await page.getByTestId('session-snapshots-toggle').click()
  const restore = page.locator('[data-testid^="snapshot-restore-"]').first()
  page.once('dialog', (d) => d.dismiss())
  await restore.click()
  await expect(page.getByTestId('node-login-title')).toHaveAttribute('style', /box-shadow/)

  page.once('dialog', (d) => d.accept())
  await restore.click()
  await expect(page.getByTestId('node-login-title')).not.toHaveAttribute('style', /box-shadow/, { timeout: 10_000 })
})
