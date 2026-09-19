/**
 * 版本历史（主流程：存版本 → 恢复 → 保存写回）——2026-09-17 补的端到端覆盖。
 *
 * 这条原来只有 `HistoryPanel.test.tsx` 的组件级用例（恢复只改本地、确认框文案），
 * **没有**"和工作台接线起来会怎样"的验证。这里补上：
 *   ① 存一个带备注的版本 → 列表出现；② 改画布 → 恢复 → 画布回退；
 *   ③ 恢复只改本地（此时服务器上还是改后的内容）；④ 再点保存 → 服务器才变成恢复后的内容。
 *
 * 前置：后端 :8000（mock）+ Vite :5173（不依赖 y-websocket）。
 */
import { expect, test, type APIRequestContext } from '@playwright/test'

const API = 'http://localhost:8000'

const DESIGN = {
  id: 'root',
  type: 'frame',
  style: { layout: 'column', width: 720 },
  children: [
    { id: 'btn1', type: 'component', componentType: 'button', props: { text: '原始文案' }, style: { width: 200, height: 40 } },
  ],
}

async function seed(request: APIRequestContext): Promise<{ id: number; token: string }> {
  const login = await request.post(`${API}/api/auth/login`, { data: { username: 'demo', password: 'demo123' } })
  const token = (await login.json()).token as string
  const created = await request.post(`${API}/api/designs`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { name: `E2E版本历史-${Date.now()}`, design: DESIGN },
  })
  return { id: (await created.json()).id as number, token }
}

async function serverText(request: APIRequestContext, token: string, id: number, nodeId: string): Promise<string | null> {
  const resp = await request.get(`${API}/api/designs/${id}`, { headers: { Authorization: `Bearer ${token}` } })
  const body = (await resp.json()) as { design: { children?: Array<{ id: string; props?: { text?: string } }> } }
  const node = body.design.children?.find((c) => c.id === nodeId)
  return node?.props?.text ?? null
}

test('版本历史：存版本 → 恢复只改本地 → 保存才写回服务器', async ({ page, request }) => {
  const { id, token } = await seed(request)
  await page.goto(`/workspace?design=${id}`)
  if (await page.getByTestId('login-password').isVisible().catch(() => false)) {
    await page.getByTestId('login-password').fill('demo123')
    await page.getByTestId('login-submit').click()
  }
  await expect(page.getByTestId('workspace-page')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId('node-btn1')).toBeVisible({ timeout: 15_000 })

  // ① 存一个带备注的版本
  await page.getByTestId('activity-history').click()
  await expect(page.getByTestId('history-panel')).toBeVisible()
  await page.getByTestId('history-note-input').fill('基线')
  await page.getByTestId('history-save-version').click()
  await expect(page.getByTestId('history-restore-1')).toBeVisible({ timeout: 10_000 })

  // ② 改画布（改文案 → 也可保存回服务器，制造"服务器上是改后内容"的状态）
  await page.getByTestId('activity-layers').click()
  await page.getByTestId('layer-btn1').click()
  await page.getByTestId('activity-props').click()
  await page.getByTestId('prop-text').fill('改过的文案')
  await expect(page.getByTestId('node-btn1')).toContainText('改过的文案')
  await page.getByTestId('save-design').click()
  await expect(page.getByTestId('unsaved-indicator')).toHaveCount(0, { timeout: 10_000 })
  // ⚠️ 必须轮询：保存是异步 PUT，`unsaved-indicator` 在"提示还没渲染"时也会瞬间 count=0，
  // 直接查服务器会抢在 PUT 之前（Postgres 上就是这么红的）。
  await expect.poll(() => serverText(request, token, id, 'btn1'), { timeout: 10_000 }).toBe('改过的文案')

  // ③ 恢复 v1：确认框 → 画布回退；**服务器此时仍是"改过的文案"**（恢复只改本地）
  page.on('dialog', (d) => void d.accept())
  await page.getByTestId('activity-history').click()
  await page.getByTestId('history-restore-1').click()
  await expect(page.getByTestId('node-btn1')).toContainText('原始文案', { timeout: 10_000 })
  expect(await serverText(request, token, id, 'btn1'), '恢复不该自己写服务器').toBe('改过的文案')

  // ④ 再点保存 → 服务器才变成恢复后的内容
  await page.getByTestId('save-design').click()
  await expect(page.getByTestId('unsaved-indicator')).toHaveCount(0, { timeout: 10_000 })
  await expect
    .poll(() => serverText(request, token, id, 'btn1'), { timeout: 10_000 })
    .toBe('原始文案')
})
