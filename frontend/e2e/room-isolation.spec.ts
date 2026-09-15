import { expect, test, type APIRequestContext } from '@playwright/test'

/**
 * P0-4 回归：Yjs room 按设计隔离——双标签打开两份不同已存设计，
 * A 标签删除节点不影响 B 标签（若 room 派生回退为全局 'design-room'，本测试应失败）。
 * 前置：后端 uvicorn :8000 + Vite dev :5173 + y-websocket :1234。
 */

const DESIGN_A = {
  id: 'root-a', type: 'frame', style: { layout: 'column', width: 500, gap: 8, padding: 20 },
  children: [{ id: 'ta', type: 'text', props: { text: 'AAA-原始' } }],
}
const DESIGN_B = {
  id: 'root-b', type: 'frame', style: { layout: 'column', width: 500, gap: 8, padding: 20 },
  children: [{ id: 'tb', type: 'text', props: { text: 'BBB-原始' } }],
}

async function createDesign(request: APIRequestContext, name: string, design: unknown): Promise<number> {
  const login = await request.post('http://localhost:8000/api/auth/login', { data: { username: 'demo', password: 'demo123' } })
  const token = (await login.json()).token
  const resp = await request.post('http://localhost:8000/api/designs', {
    headers: { Authorization: `Bearer ${token}` },
    data: { name, design },
  })
  expect(resp.ok()).toBeTruthy()
  return (await resp.json()).id
}

test('不同已存设计的双标签互不影响（room 按 design id 隔离）', async ({ page, request }) => {
  test.setTimeout(90_000)
  const idA = await createDesign(request, 'E2E-Room-A', DESIGN_A)
  const idB = await createDesign(request, 'E2E-Room-B', DESIGN_B)

  // 标签 A：登录并打开设计 A（无显式 ?room=，应派生 design-{idA}）
  await page.goto(`/workspace?design=${idA}`)
  if (await page.getByTestId('login-password').isVisible().catch(() => false)) {
    await page.getByTestId('login-password').fill('demo123')
    await page.getByTestId('login-submit').click()
  }
  await expect(page.getByTestId('workspace-page')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId('node-ta')).toBeVisible({ timeout: 15_000 })

  // 标签 B：同一登录会话打开设计 B
  const pageB = await page.context().newPage()
  await pageB.goto(`/workspace?design=${idB}`)
  await expect(pageB.getByTestId('workspace-page')).toBeVisible({ timeout: 15_000 })
  await expect(pageB.getByTestId('node-tb')).toBeVisible({ timeout: 15_000 })
  // 等待 Yjs 初始同步稳定（room 若未隔离，此处 B 画布会被 A 树覆盖）
  await page.waitForTimeout(800)
  await expect(pageB.getByTestId('node-tb')).toBeVisible()

  // A 标签删除自己的文本节点
  await page.getByTestId('node-ta').click()
  await expect(page.getByTestId('prop-delete')).toBeVisible()
  await page.getByTestId('prop-delete').click()
  await expect(page.getByTestId('node-ta')).toHaveCount(0)

  // B 标签不受影响：自己的节点仍在、A 的内容/删除未同步过来
  await page.waitForTimeout(800)
  await expect(pageB.getByTestId('node-tb')).toBeVisible()
  await expect(pageB.getByText('AAA-原始')).toHaveCount(0)

  await pageB.close()
})
