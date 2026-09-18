/**
 * 缺陷 5 端到端：**AI 对话跟着项目走**。
 *
 * 用户实测反馈："同一个项目打开，用户与 AI 的对话应该还在，而不是清空；不同项目之间的对话记录应该分开。"
 * 根因：保存前的画布用的是**随机会话 key**（绑定关系落在 `chat_sessions.design_id` 上），
 * 而从首页/我的项目打开走的是 `?design={id}` → 会话 key 被派生成 `s-design-{id}`（另一条空会话）。
 *
 * 覆盖三点：
 *   ① 空白画布聊天 → 保存为项目；② 新开页面按 `?design={id}` 打开 → 对话仍在，且 URL 指回原会话；
 *   ③ 另一个项目打开 → 看不到这段对话（对话按项目分开）。
 *
 * 前置：后端 :8000（mock）+ Vite :5173。
 */
import { expect, test } from '@playwright/test'

const API = 'http://localhost:8000'

test('对话随项目留存：重开项目仍在，换项目看不到', async ({ page, context, request }) => {
  test.setTimeout(120_000)
  const tag = Math.random().toString(36).slice(2, 8)
  const sessionKey = `s-keep${tag}`

  // ① 空白画布 → 聊一句（mock 后端即时出稿）
  await page.goto(`/workspace?session=${sessionKey}&from=blank`)
  if (await page.getByTestId('login-password').isVisible().catch(() => false)) {
    await page.getByTestId('login-password').fill('demo123')
    await page.getByTestId('login-submit').click()
  }
  await expect(page.getByTestId('workspace-page')).toBeVisible({ timeout: 15_000 })
  await page.getByTestId('activity-ai').click()
  await expect(page.getByTestId('ai-chat-panel')).toBeVisible()
  await page.getByTestId('chat-input').fill('设计一个登录页面，简洁现代风格')
  await page.getByTestId('chat-send').click()
  await expect(page.getByTestId('chat-msg-assistant-2')).toContainText('已生成设计稿', { timeout: 30_000 })

  // 保存为项目（保存后 URL 会带上 ?design={id}，会话仍是原来那条）
  await page.getByTestId('save-design').click()
  await expect(page.getByTestId('save-dialog')).toBeVisible()
  await page.getByTestId('save-name-input').fill(`E2E对话留存-${tag}`)
  await page.getByTestId('save-name-confirm').click()
  await expect(page.getByTestId('save-dialog')).toHaveCount(0, { timeout: 15_000 })
  const designId = Number(/[?&]design=(\d+)/.exec(page.url())?.[1])
  expect(designId).toBeGreaterThan(0)

  // 服务端绑定是保存后异步发生的（PATCH /api/sessions/{key}）：等它落库再重开，避免抢跑
  const token = (await (await request.post(`${API}/api/auth/login`, { data: { username: 'demo', password: 'demo123' } })).json()).token as string
  await expect
    .poll(
      async () => {
        const r = await request.get(`${API}/api/sessions?design_id=${designId}`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        return ((await r.json()) as { sessions: Array<{ session_id: string }> }).sessions.map((s) => s.session_id)
      },
      { timeout: 10_000 },
    )
    .toEqual([sessionKey])

  // ② 新开一个页面，按「我的项目」的入口方式打开同一个项目
  const reopened = await context.newPage()
  await reopened.goto(`/workspace?design=${designId}`)
  await expect(reopened.getByTestId('workspace-page')).toBeVisible({ timeout: 15_000 })
  await reopened.getByTestId('activity-ai').click()
  await expect(reopened.getByTestId('chat-msg-user-1')).toContainText('设计一个登录页面', { timeout: 15_000 })
  // 对话真的来自原会话，而不是新开的空会话（这也是"分享该 URL 能回到同一段对话"的前提）
  await expect
    .poll(() => new URL(reopened.url()).searchParams.get('session'), { timeout: 10_000 })
    .toBe(sessionKey)

  // ③ 另一个项目：看不到这段对话（按项目隔离）
  const otherId = (await (
    await request.post(`${API}/api/designs`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: `E2E对话隔离-${tag}`, design: { id: 'root', type: 'frame', children: [] } },
    })
  ).json()).id as number
  await reopened.goto(`/workspace?design=${otherId}`)
  await expect(reopened.getByTestId('workspace-page')).toBeVisible({ timeout: 15_000 })
  await reopened.getByTestId('activity-ai').click()
  await expect(reopened.getByTestId('chat-msg-user-1')).toHaveCount(0)
  await expect(reopened.getByTestId('chat-msg-assistant-2')).toHaveCount(0)

  await reopened.close()
})
