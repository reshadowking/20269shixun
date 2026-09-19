/**
 * 智能优化布局（✨ 工具栏按钮）的端到端接线 —— 2026-09-17 补的覆盖。
 *
 * 这条此前只有服务端规则的单测（`test_optimizer*.py`）与差量落地的组件测试，
 * "按钮 → 调接口 → 差量落地到画布 → 报告数字 → 撤销还原"整段没有 E2E。
 *
 * 用的确定性样例（规则见 `backend/app/services/optimizer.py`）：
 *   - 根容器 `padding: 13` → 不在间距台阶上 → 归到最近台阶 **12**（1 处间距）；
 *   - 三个同类型按钮宽度 160 / 160 / 200 → 取众数 **160**（1 处尺寸）。
 * 于是报告应当正好是"已优化 1 处间距、0 处对齐、1 处尺寸"。
 *
 * 前置：后端 :8000（mock）+ Vite :5173。
 */
import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

const API = 'http://localhost:8000'

const DESIGN = {
  id: 'root',
  type: 'frame',
  style: { layout: 'column', width: 400, padding: 13, gap: 8, background: '#FFFFFF' },
  children: [
    { id: 'b1', type: 'component', componentType: 'button', props: { text: 'A', variant: 'primary' }, style: { width: 160, height: 40 } },
    { id: 'b2', type: 'component', componentType: 'button', props: { text: 'B', variant: 'primary' }, style: { width: 160, height: 40 } },
    { id: 'b3', type: 'component', componentType: 'button', props: { text: 'C', variant: 'primary' }, style: { width: 200, height: 40 } },
  ],
}

async function createDesign(request: APIRequestContext): Promise<number> {
  const login = await request.post(`${API}/api/auth/login`, { data: { username: 'demo', password: 'demo123' } })
  const token = (await login.json()).token as string
  const created = await request.post(`${API}/api/designs`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { name: `E2E优化布局-${Date.now()}`, design: DESIGN },
  })
  return (await created.json()).id as number
}

/** 读某个画布节点的内联样式（设计树写回的就是它） */
function inlineStyle(page: Page, nodeId: string, prop: 'padding' | 'width') {
  return page.locator(`[data-node-id="${nodeId}"]`).evaluate((el, p) => (el as HTMLElement).style[p as 'padding'], prop)
}

test('智能优化布局：统一间距/尺寸 → 报告数字正确 → 撤销完整还原', async ({ page, request }) => {
  const id = await createDesign(request)
  await page.goto(`/workspace?design=${id}`)
  if (await page.getByTestId('login-password').isVisible().catch(() => false)) {
    await page.getByTestId('login-password').fill('demo123')
    await page.getByTestId('login-submit').click()
  }
  await expect(page.getByTestId('workspace-page')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId('node-b3')).toBeVisible({ timeout: 15_000 })

  // 优化前：13px / 200px
  expect(await inlineStyle(page, 'root', 'padding')).toBe('13px')
  expect(await inlineStyle(page, 'b3', 'width')).toBe('200px')

  await page.getByTestId('optimize-layout').click()

  const report = page.getByTestId('optimize-report')
  await expect(report).toBeVisible({ timeout: 15_000 })
  await expect(report).toContainText('已优化 1 处间距、0 处对齐、1 处尺寸')

  // 差量落地到画布：padding 归台阶、第三个按钮宽度取众数
  await expect.poll(() => inlineStyle(page, 'root', 'padding')).toBe('12px')
  await expect.poll(() => inlineStyle(page, 'b3', 'width')).toBe('160px')
  // 前两个本来就一致，不应被动过
  expect(await inlineStyle(page, 'b1', 'width')).toBe('160px')

  // 撤销：一次回到优化前（报告面板随之关闭）
  await page.getByTestId('optimize-report-undo').click()
  await expect(report).toHaveCount(0)
  await expect.poll(() => inlineStyle(page, 'root', 'padding')).toBe('13px')
  await expect.poll(() => inlineStyle(page, 'b3', 'width')).toBe('200px')
})
