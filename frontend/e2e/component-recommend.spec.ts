/**
 * 组件智能推荐（E3-3）端到端接线 —— 2026-09-17 补的覆盖。
 *
 * 此前只有组件级用例；"画布右键 → 菜单「✨ 推荐组件」→ 浮层加载 → 点一条 → 插进那个容器"整段没有 E2E。
 *
 * 前置：后端 :8000（mock；推荐器是**规则引擎**，不调 LLM）+ Vite :5173。
 */
import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

const API = 'http://localhost:8000'

const DESIGN = {
  id: 'root',
  type: 'frame',
  style: { layout: 'column', width: 400, padding: 16, gap: 12, background: '#FFFFFF' },
  children: [
    { id: 't1', type: 'text', props: { text: '登录' }, style: { color: 'text-primary' } },
    { id: 'b1', type: 'component', componentType: 'button', props: { text: '提交', variant: 'primary' }, style: { width: 160, height: 40 } },
  ],
}

async function open(page: Page, request: APIRequestContext) {
  const login = await request.post(`${API}/api/auth/login`, { data: { username: 'demo', password: 'demo123' } })
  const token = (await login.json()).token as string
  const created = await request.post(`${API}/api/designs`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { name: `E2E推荐-${Date.now()}`, design: DESIGN },
  })
  const id = (await created.json()).id as number
  await page.goto(`/workspace?design=${id}`)
  if (await page.getByTestId('login-password').isVisible().catch(() => false)) {
    await page.getByTestId('login-password').fill('demo123')
    await page.getByTestId('login-submit').click()
  }
  await expect(page.getByTestId('workspace-page')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId('node-b1')).toBeVisible({ timeout: 15_000 })
}

test('组件推荐：右键容器 → 菜单入口 → 浮层出推荐 → 点一条插进该容器', async ({ page, request }) => {
  await open(page, request)
  const nodes = page.locator('[data-node-id]')
  const before = await nodes.count()

  // 右键根容器（空白处也行，但容器上语义更明确）
  await page.getByTestId('node-root').click({ button: 'right' })
  await expect(page.getByTestId('context-menu')).toBeVisible()
  // 右键要落在**节点**上，"推荐组件"才可用（落在画布空白处时 nodeId 为空、按钮 disabled）
  const menuDump = await page.getByTestId('context-menu').innerText()
  expect(menuDump, `菜单内容：${menuDump}`).toContain('推荐组件')
  expect(await page.getByTestId('ctx-recommend').isEnabled(), '右键应命中节点（否则该项 disabled）').toBe(true)
  await page.getByTestId('ctx-recommend').click()

  const popover = page.getByTestId('recommend-popover')
  await expect(popover).toBeVisible()
  await expect(popover.getByTestId('recommend-list')).toBeVisible({ timeout: 15_000 })

  const item = popover.locator('[data-testid^="recommend-item-"]').first()
  await expect(item).toBeVisible()
  await item.click()

  // 插进容器 = 画布上多一个节点；推荐浮层随之关闭
  await expect.poll(() => nodes.count()).toBe(before + 1)
  await expect(popover).toHaveCount(0)
})

/**
 * 同一个根因的另一面：右键菜单里的「复制」「删除」原来也是死的
 * （pointerdown 先把菜单卸载，click 落不到菜单项上）。
 */
test('右键菜单：复制与删除都真的生效', async ({ page, request }) => {
  await open(page, request)
  const nodes = page.locator('[data-node-id]')
  const before = await nodes.count()

  await page.getByTestId('node-b1').click({ button: 'right' })
  await expect(page.getByTestId('context-menu')).toBeVisible()
  await page.getByTestId('ctx-duplicate').click()
  await expect.poll(() => nodes.count()).toBe(before + 1)

  await page.getByTestId('node-b1').click({ button: 'right' })
  await expect(page.getByTestId('context-menu')).toBeVisible()
  await page.getByTestId('ctx-delete').click()
  await expect(page.getByTestId('node-b1')).toHaveCount(0)
})
