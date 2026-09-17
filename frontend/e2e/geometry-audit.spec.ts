/**
 * 几何体检（🧭 工具栏按钮）的端到端接线 —— 2026-09-17 补的覆盖。
 *
 * 这条此前**只测过纯规则函数**（`geometryAudit.test.ts`），"按钮 → 量真实 DOM → 面板列出问题 → 高亮/关闭"
 * 这段接线没有任何 E2E；而本项目好几处真 bug 恰好就藏在"规则对、接线错"的位置。
 *
 * 两个方向的断言：
 *   ① **有问题**：绝对定位子节点越界 → 报"溢出"；低对比度文字（#888 于白底 ≈3.5:1）→ 报"对比度"；
 *   ② **无误报**（钉住 430ed5b 的修复）：只放 icon / divider / image 的容器**不许**被报"空容器"。
 *
 * 前置：后端 :8000（mock）+ Vite :5173。
 */
import { expect, test, type APIRequestContext } from '@playwright/test'

const API = 'http://localhost:8000'

/** 有问题：宽按钮越出 400 宽的画布；灰字在白底上对比度不足 */
const BROKEN = {
  id: 'root',
  type: 'frame',
  style: { layout: 'free', width: 400, height: 300, background: '#FFFFFF' },
  children: [
    { id: 'wide', type: 'component', componentType: 'button', x: 380, y: 20, props: { text: '越界按钮' }, style: { width: 200, height: 40 } },
    { id: 'dim', type: 'text', x: 20, y: 140, props: { text: '对比度偏低' }, style: { color: '#888888' } },
  ],
}

/** 干净稿：只有 icon / divider / image 的容器 + 一个正常按钮（都不该被报） */
const CLEAN = {
  id: 'root',
  type: 'frame',
  style: { layout: 'column', width: 400, padding: 16, background: '#FFFFFF', gap: 12 },
  children: [
    { id: 'ic', type: 'component', componentType: 'icon', props: { name: 'plus', color: 'primary' }, style: { width: 24, height: 24 } },
    { id: 'dv', type: 'component', componentType: 'divider', props: {}, style: { width: 360, height: 1 } },
    { id: 'im', type: 'component', componentType: 'image', props: { alt: '占位图' }, style: { width: 160, height: 120 } },
    { id: 'bt', type: 'component', componentType: 'button', props: { text: '正常按钮', variant: 'primary' }, style: { width: 160, height: 40 } },
  ],
}

async function createDesign(request: APIRequestContext, design: unknown): Promise<number> {
  const login = await request.post(`${API}/api/auth/login`, { data: { username: 'demo', password: 'demo123' } })
  const token = (await login.json()).token as string
  const created = await request.post(`${API}/api/designs`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { name: `E2E几何体检-${Date.now()}`, design },
  })
  return (await created.json()).id as number
}

async function openWorkspace(page: import('@playwright/test').Page, id: number) {
  await page.goto(`/workspace?design=${id}`)
  if (await page.getByTestId('login-password').isVisible().catch(() => false)) {
    await page.getByTestId('login-password').fill('demo123')
    await page.getByTestId('login-submit').click()
  }
  await expect(page.getByTestId('workspace-page')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId('node-root')).toBeVisible({ timeout: 15_000 })
}

test('几何体检：量真实 DOM 并列出问题（溢出 / 对比度），可关闭', async ({ page, request }) => {
  const id = await createDesign(request, BROKEN)
  await openWorkspace(page, id)

  await page.getByTestId('geometry-audit').click()
  const panel = page.getByTestId('geometry-audit-panel')
  await expect(panel).toBeVisible()
  await expect(panel).toContainText('项') // "几何体检：N 项"
  await expect(panel).toContainText('溢出')
  await expect(panel).toContainText('对比度')

  // 点某条问题 → 只是高亮（只读，不改设计树）：画布节点数量不变
  await page.getByTestId('audit-issue-0').click()
  await expect(page.getByTestId('node-wide')).toHaveCount(1)

  await page.getByTestId('audit-close').click()
  await expect(panel).toHaveCount(0)
})

test('几何体检：icon / divider / image 不许被误报"空容器"（430ed5b 回归守门）', async ({ page, request }) => {
  const id = await createDesign(request, CLEAN)
  await openWorkspace(page, id)

  await page.getByTestId('geometry-audit').click()
  const panel = page.getByTestId('geometry-audit-panel')
  await expect(panel).toBeVisible()
  await expect(panel).toContainText('未发现问题', { timeout: 10_000 })
  await expect(panel).not.toContainText('空容器')
})
