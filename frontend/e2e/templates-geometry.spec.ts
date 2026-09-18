/**
 * 生成质量的**确定性**守门：8 个模板稿（mock 直接产出、real 模式的骨架）逐个过几何体检。
 *
 * 为什么值得单独一条：AI 生成效果没法在本地稳定复现（要真模型 + 花钱），
 * 但"生成物会不会溢出、文字会不会被截断、颜色对比度够不够、容器是不是空的"是**规则的**，
 * 模板就是生成物的下限——模板自己有问题，用户看到的每一稿都带着同一个毛病。
 *
 * 体检由页面里的「🧭 体检」按钮驱动（量真实 DOM），与 `geometry-audit.spec.ts` 同一路径。
 * 前置：后端 :8000（mock）+ Vite :5173。
 */
import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

const API = 'http://localhost:8000'

async function createDesign(request: APIRequestContext, token: string, design: unknown, name: string): Promise<number> {
  const created = await request.post(`${API}/api/designs`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { name, design },
  })
  expect(created.ok(), `建稿件失败：${created.status()}`).toBeTruthy()
  return (await created.json()).id as number
}

async function openWorkspace(page: Page, id: number) {
  await page.goto(`/workspace?design=${id}`)
  if (await page.getByTestId('login-password').isVisible().catch(() => false)) {
    await page.getByTestId('login-password').fill('demo123')
    await page.getByTestId('login-submit').click()
  }
  await expect(page.getByTestId('workspace-page')).toBeVisible({ timeout: 15_000 })
}

test('8 个模板稿逐个过几何体检：没有溢出/截断/低对比度/空容器', async ({ page, request }) => {
  test.setTimeout(180_000)
  const token = (await (await request.post(`${API}/api/auth/login`, { data: { username: 'demo', password: 'demo123' } })).json()).token as string
  const list = (await (await request.get(`${API}/api/generate/templates`, { headers: { Authorization: `Bearer ${token}` } })).json())
    .templates as Array<{ key: string; name: string }>
  expect(list.length).toBe(8)

  const report: string[] = []
  const failures: string[] = []
  for (const t of list) {
    const detail = await (
      await request.get(`${API}/api/generate/templates/${t.key}`, { headers: { Authorization: `Bearer ${token}` } })
    ).json()
    const id = await createDesign(request, token, detail.design, `E2E模板体检-${t.key}-${Date.now()}`)
    await openWorkspace(page, id)
    await expect(page.getByTestId(`node-${detail.design.id}`)).toBeVisible({ timeout: 15_000 })

    await page.getByTestId('geometry-audit').click()
    const panel = page.getByTestId('geometry-audit-panel')
    await expect(panel).toBeVisible()
    await expect(panel).toContainText('体检', { timeout: 10_000 })
    const text = ((await panel.textContent()) ?? '').replace(/\s+/g, ' ').trim()
    report.push(`${t.key}（${t.name}）→ ${text.slice(0, 400)}`)
    if (!text.includes('未发现问题')) failures.push(`${t.key}（${t.name}）→ ${text.slice(0, 300)}`)
    await page.getByTestId('audit-close').click()
  }
  test.info().annotations.push({ type: 'templates', description: report.join(' | ') })
  // 一次性报出**所有**有问题的模板（免得修一个跑一次）
  expect(failures, '模板稿的几何体检结果').toEqual([])
})
