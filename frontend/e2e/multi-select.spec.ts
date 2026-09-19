/**
 * 多选批量编辑（属性面板的 `MultiSelectPanel`）端到端接线 —— 2026-09-17 补的覆盖。
 *
 * 这条此前只有组件级用例，**画布 Ctrl+多选 → 面板出现 → 一次改到所有选中节点 → 批量删除** 整段没有 E2E。
 * 口径（`DesignCanvas.handleNodePointerDown`）：按住 Ctrl 点节点是在多选集合里**增删**，不按则单选。
 *
 * 前置：后端 :8000（mock）+ Vite :5173。
 */
import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

const API = 'http://localhost:8000'

const DESIGN = {
  id: 'root',
  type: 'frame',
  style: { layout: 'column', width: 400, padding: 16, gap: 8, background: '#FFFFFF' },
  children: [
    { id: 'b1', type: 'component', componentType: 'button', props: { text: 'A', variant: 'primary' }, style: { width: 160, height: 40 } },
    { id: 'b2', type: 'component', componentType: 'button', props: { text: 'B', variant: 'primary' }, style: { width: 200, height: 40 } },
  ],
}

function inlineWidth(page: Page, nodeId: string) {
  return page.locator(`[data-node-id="${nodeId}"]`).evaluate((el) => (el as HTMLElement).style.width)
}

async function open(page: Page, request: APIRequestContext) {
  const login = await request.post(`${API}/api/auth/login`, { data: { username: 'demo', password: 'demo123' } })
  const token = (await login.json()).token as string
  const created = await request.post(`${API}/api/designs`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { name: `E2E多选-${Date.now()}`, design: DESIGN },
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

test('多选：Ctrl 点两个节点 → 面板出现 → 一次把宽度统一到所有选中节点', async ({ page, request }) => {
  await open(page, request)
  expect(await inlineWidth(page, 'b2')).toBe('200px')

  await page.getByTestId('node-b1').click()
  await page.getByTestId('node-b2').click({ modifiers: ['Control'] })

  const panel = page.getByTestId('multi-select-panel')
  await expect(panel).toBeVisible()
  await expect(panel).toContainText('已选 2 个节点')

  // 两个宽度不同 → 输入框显示占位"混合"；填一个值即统一下去
  const width = page.getByTestId('multi-width')
  await expect(width).toHaveAttribute('placeholder', '混合（点此输入统一值）')
  await width.fill('180')

  await expect.poll(() => inlineWidth(page, 'b1')).toBe('180px')
  await expect.poll(() => inlineWidth(page, 'b2')).toBe('180px')
})

test('多选：批量删除一次清掉所有选中节点', async ({ page, request }) => {
  await open(page, request)

  await page.getByTestId('node-b1').click()
  await page.getByTestId('node-b2').click({ modifiers: ['Control'] })
  await expect(page.getByTestId('multi-select-panel')).toContainText('已选 2 个节点')

  await page.getByTestId('multi-delete-all').click()

  await expect(page.getByTestId('node-b1')).toHaveCount(0)
  await expect(page.getByTestId('node-b2')).toHaveCount(0)
})
