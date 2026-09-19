/**
 * 自由画布下"没有坐标的新节点"落在哪？（2026-09-18）
 *
 * 背景：`autoFreezeAfterAi` 现在会把整棵树冻成 `layout: free`（生成即可拖）。
 * 那么**之后**的 AI 增量修改（"再加一个按钮"）新增的节点没有 `x/y` —— 模型看不见
 * "父级是不是 free"，正常不会给坐标。此时渲染侧 `left/top` 都是 undefined，
 * 绝对定位元素会退回**静态位置**（左上角），压住原有内容。
 *
 * 本用例就是钉这条：free 父级下没有坐标的节点**不许**和已有节点重叠，也不许跑到画布外。
 * 前置：后端 :8000（mock）+ Vite :5173。
 */
import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

const API = 'http://localhost:8000'

/** 自由布局 + 一个"AI 新增但没给坐标"的节点（模拟模型只给 props/style 的样子） */
const FREE_WITH_ORPHAN = {
  id: 'root',
  type: 'frame',
  style: { layout: 'free', width: 600, height: 400, padding: 16, background: '#FFFFFF' },
  children: [
    {
      id: 'a',
      type: 'component',
      componentType: 'button',
      x: 24,
      y: 24,
      props: { text: '已有按钮' },
      style: { width: 120, height: 40 },
    },
    {
      id: 'new1',
      type: 'component',
      componentType: 'button',
      props: { text: 'AI 新增的按钮' },
      style: { width: 120, height: 40 },
    },
  ],
}

async function createDesign(request: APIRequestContext, design: unknown): Promise<number> {
  const token = (await (await request.post(`${API}/api/auth/login`, { data: { username: 'demo', password: 'demo123' } })).json()).token as string
  const created = await request.post(`${API}/api/designs`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { name: `E2E自由画布孤儿节点-${Date.now()}`, design },
  })
  expect(created.ok(), `建稿件失败：${created.status()}`).toBeTruthy()
  return (await created.json()).id as number
}

async function open(page: Page, id: number) {
  await page.goto(`/workspace?design=${id}`)
  if (await page.getByTestId('login-password').isVisible().catch(() => false)) {
    await page.getByTestId('login-password').fill('demo123')
    await page.getByTestId('login-submit').click()
  }
  await expect(page.getByTestId('workspace-page')).toBeVisible({ timeout: 15_000 })
}

test('free 父级下没有坐标的新节点不许压住已有节点', async ({ page, request }) => {
  test.setTimeout(60_000)
  const id = await createDesign(request, FREE_WITH_ORPHAN)
  await open(page, id)

  const existing = page.getByTestId('node-a')
  const orphan = page.getByTestId('node-new1')
  await expect(existing).toBeVisible({ timeout: 15_000 })
  await expect(orphan).toBeVisible()

  const a = (await existing.boundingBox())!
  const b = (await orphan.boundingBox())!
  const overlap = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) > 4 &&
    Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) > 4
  expect(overlap, `新节点落在已有节点上（a=${JSON.stringify(a)} b=${JSON.stringify(b)}）`).toBe(false)

  // 也不许跑到画布（纸张）外面
  const sheet = (await page.getByTestId('canvas-sheet').boundingBox())!
  expect(b.x, '新节点跑出画布左侧').toBeGreaterThanOrEqual(sheet.x - 1)
  expect(b.y, '新节点跑出画布顶部').toBeGreaterThanOrEqual(sheet.y - 1)
})
