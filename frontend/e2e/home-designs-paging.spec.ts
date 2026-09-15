import { expect, test, type Page } from '@playwright/test'

/**
 * 缺陷 2 回归：「最近的设计」默认最多 8 条 +「查看更多 / 收起」（真实后端分页链路）。
 * 前置：后端 :8000 + Vite :5173（本用例不进工作台，不依赖 y-websocket）。
 * 数据策略：只创建/清理带本用例前缀的设计，不动账号既有数据；条数断言基于基线相对值。
 */

const PREFIX = 'E2E分页-'

const SAMPLE = {
  id: 'root',
  type: 'frame',
  style: { layout: 'column', width: 720 },
  children: [{ id: 't', type: 'text', props: { text: '标题' } }],
}

async function loginHome(page: Page) {
  await page.goto('/')
  if (await page.getByTestId('login-password').isVisible().catch(() => false)) {
    await page.getByTestId('login-password').fill('demo123')
    await page.getByTestId('login-submit').click()
  }
  await expect(page.getByTestId('home-user')).toBeVisible({ timeout: 15_000 })
}

async function api<T>(page: Page, path: string, options: RequestInit = {}): Promise<T> {
  const token = await page.evaluate(() => localStorage.getItem('design-tool-token'))
  const resp = await page.request.fetch(path, {
    ...options,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(options.headers ?? {}) },
  })
  expect(resp.ok(), `${path} → HTTP ${resp.status()}`).toBeTruthy()
  return (await resp.json()) as T
}

/** 清理本用例前缀的历史残留（不触碰其他数据） */
async function cleanPrefix(page: Page): Promise<void> {
  const { designs } = await api<{ designs: Array<{ id: number; name: string }> }>(page, '/api/designs')
  for (const d of designs.filter((x) => x.name.startsWith(PREFIX))) {
    await api(page, `/api/designs/${d.id}`, { method: 'DELETE' })
  }
}

async function seed(page: Page, names: string[]): Promise<number[]> {
  const ids: number[] = []
  for (const name of names) {
    const created = await api<{ id: number }>(page, '/api/designs', {
      method: 'POST',
      data: JSON.stringify({ name, design: SAMPLE }),
    })
    ids.push(created.id)
  }
  return ids
}

async function remove(page: Page, ids: number[]): Promise<void> {
  for (const id of ids) await api(page, `/api/designs/${id}`, { method: 'DELETE' })
}

function cards(page: Page) {
  return page.locator('[data-testid^="home-design-"]:not([data-testid^="home-design-delete-"])')
}

test('0 条：空状态，无「查看更多」按钮', async ({ page }) => {
  await loginHome(page)
  await cleanPrefix(page)
  const { total } = await api<{ total: number; designs: unknown[] }>(page, '/api/designs')
  test.skip(total > 0, '当前账号已有其他历史设计（共享库），空态需在空库下验证')

  await page.reload()
  await expect(page.getByTestId('home-empty')).toBeVisible({ timeout: 10_000 })
  await expect(page.getByTestId('home-load-more')).toHaveCount(0)
  await expect(page.getByTestId('home-collapse')).toHaveCount(0)
})

/** 该 spec 只清理自己的前缀数据，因此条数断言必须"相对基线"：共享库（账号已有设计）下也能跑 */
test('1 条 / 8 条：全部展示，无「查看更多」（不允许空按钮）', async ({ page }) => {
  await loginHome(page)
  await cleanPrefix(page)
  const base = (await api<{ total: number }>(page, '/api/designs')).total
  const seeded = await seed(page, [`${PREFIX}1`])
  try {
    await page.reload()
    // 边界不变式：可见卡片数 = min(8, 总数)；仅当总数 > 8 才出现「查看更多」
    await expect(cards(page)).toHaveCount(Math.min(8, base + 1), { timeout: 10_000 })
    await expect(page.getByTestId('home-load-more')).toHaveCount(base + 1 > 8 ? 1 : 0)

    if (base === 0) {
      // 空库环境（CI/一次性库）下补齐严格边界：正好 8 条 → 全展示且无按钮
      await seed(page, Array.from({ length: 7 }, (_, i) => `${PREFIX}${i + 2}`))
      await page.reload()
      await expect(cards(page)).toHaveCount(8, { timeout: 10_000 })
      await expect(page.getByTestId('home-load-more')).toHaveCount(0)
      await expect(page.getByTestId('home-collapse')).toHaveCount(0)
    }
  } finally {
    const { designs } = await api<{ designs: Array<{ id: number; name: string }> }>(page, '/api/designs')
    await remove(page, designs.filter((d) => d.name.startsWith(PREFIX)).map((d) => d.id))
  }
  void seeded
})

test('9 条：默认 8 条 → 查看更多展开剩余 → 收起回 8 条', async ({ page }) => {
  await loginHome(page)
  await cleanPrefix(page)
  const base = (await api<{ total: number }>(page, '/api/designs')).total
  const ids = await seed(page, Array.from({ length: 9 }, (_, i) => `${PREFIX}${i + 1}`))
  const total = base + 9
  try {
    const firstPage = page.waitForResponse(
      (r) => r.url().includes('/api/designs?limit=8&offset=0') && r.status() === 200,
      { timeout: 15_000 },
    )
    await page.reload()
    await firstPage // 首屏只请求 8 条（后端分页，数据来源可观测）

    await expect(cards(page)).toHaveCount(8, { timeout: 10_000 })
    await expect(page.getByTestId('home-load-more')).toBeVisible()

    await page.getByTestId('home-load-more').click()
    await expect(cards(page)).toHaveCount(total, { timeout: 15_000 })
    await expect(page.getByTestId('home-collapse')).toBeVisible()
    await expect(page.getByTestId('home-load-more')).toHaveCount(0)

    await page.getByTestId('home-collapse').click()
    await expect(cards(page)).toHaveCount(8, { timeout: 10_000 })
    await expect(page.getByTestId('home-load-more')).toBeVisible()
  } finally {
    await remove(page, ids)
  }
})

test('100 条：默认 8 条 → 查看更多一次加载全部剩余 → 收起', async ({ page }) => {
  test.setTimeout(120_000)
  await loginHome(page)
  await cleanPrefix(page)
  const base = (await api<{ total: number }>(page, '/api/designs')).total
  const ids = await seed(page, Array.from({ length: 100 }, (_, i) => `${PREFIX}${i + 1}`))
  const total = base + 100
  try {
    await page.reload()
    await expect(cards(page)).toHaveCount(8, { timeout: 10_000 })
    await expect(page.getByTestId('home-load-more')).toBeVisible()

    await page.getByTestId('home-load-more').click()
    await expect(cards(page)).toHaveCount(total, { timeout: 60_000 })
    await expect(page.getByTestId('home-collapse')).toBeVisible()

    await page.getByTestId('home-collapse').click()
    await expect(cards(page)).toHaveCount(8, { timeout: 10_000 })
  } finally {
    await remove(page, ids)
  }
})

test('其他入口不受影响：新建空白画布 / 示例 / 模板起手可见可用', async ({ page }) => {
  await loginHome(page)
  await cleanPrefix(page)

  await expect(page.getByTestId('home-new-blank')).toBeVisible()
  await expect(page.getByTestId('home-new-demo')).toBeVisible()
  await expect(page.getByTestId('home-template-login')).toBeVisible({ timeout: 10_000 })

  // 空白画布入口仍可进入工作台（列表改版不影响其他起手路径）
  await page.getByTestId('home-new-blank').click()
  await expect(page.getByTestId('workspace-page')).toBeVisible({ timeout: 15_000 })
  await page.getByTestId('go-home').click()
  await expect(page.getByTestId('home-user')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId('home-new-blank')).toBeVisible()
})
