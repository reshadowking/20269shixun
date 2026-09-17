/**
 * 对齐/分布工具栏的 **free 布局**路径 —— 2026-09-17 补的覆盖。
 *
 * `workbench.spec.ts` 只覆盖了 flex 那条（改父容器 justify/alignItems）；free 那条才是
 * "靠真实 DOM 测量 + 直接改节点坐标/尺寸"的路径，之前那两处真 bug（量不到拿 0、全局 querySelector
 * 命中多投影层）都出在这里。
 *
 * 语义（`frontend/src/canvas/align.ts`）：left/top 取组内最小值；uniform 取组内最大宽高。
 *
 * 前置：后端 :8000（mock）+ Vite :5173。
 */
import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

const API = 'http://localhost:8000'

const DESIGN = {
  id: 'root',
  type: 'frame',
  style: { layout: 'free', width: 600, height: 400, background: '#FFFFFF' },
  children: [
    { id: 'f1', type: 'component', componentType: 'button', x: 20, y: 20, props: { text: 'A' }, style: { width: 120, height: 40 } },
    { id: 'f2', type: 'component', componentType: 'button', x: 80, y: 120, props: { text: 'B' }, style: { width: 160, height: 60 } },
    { id: 'f3', type: 'component', componentType: 'button', x: 200, y: 260, props: { text: 'C' }, style: { width: 100, height: 40 } },
  ],
}

function style(page: Page, nodeId: string, prop: 'left' | 'top' | 'width' | 'height') {
  return page.locator(`[data-node-id="${nodeId}"]`).evaluate((el, p) => (el as HTMLElement).style[p as 'left'], prop)
}

async function open(page: Page, request: APIRequestContext) {
  const login = await request.post(`${API}/api/auth/login`, { data: { username: 'demo', password: 'demo123' } })
  const token = (await login.json()).token as string
  const created = await request.post(`${API}/api/designs`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { name: `E2E对齐-fre-${Date.now()}`, design: DESIGN },
  })
  const id = (await created.json()).id as number
  await page.goto(`/workspace?design=${id}`)
  if (await page.getByTestId('login-password').isVisible().catch(() => false)) {
    await page.getByTestId('login-password').fill('demo123')
    await page.getByTestId('login-submit').click()
  }
  await expect(page.getByTestId('workspace-page')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId('node-f1')).toBeVisible({ timeout: 15_000 })
}

/** Ctrl+点三个节点（与画布多选口径一致） */
async function selectThree(page: Page) {
  await page.getByTestId('node-f1').click()
  await page.getByTestId('node-f2').click({ modifiers: ['Control'] })
  await page.getByTestId('node-f3').click({ modifiers: ['Control'] })
  await expect(page.getByTestId('multi-select-panel')).toContainText('已选 3 个节点')
}

test('free 布局：顶对齐 / 左对齐按组内最小值落到真实坐标', async ({ page, request }) => {
  await open(page, request)
  await selectThree(page)

  await page.getByTestId('align-top').click()
  await expect.poll(() => style(page, 'f1', 'top')).toBe('20px')
  await expect.poll(() => style(page, 'f2', 'top')).toBe('20px')
  await expect.poll(() => style(page, 'f3', 'top')).toBe('20px')

  await page.getByTestId('align-left').click()
  await expect.poll(() => style(page, 'f1', 'left')).toBe('20px')
  await expect.poll(() => style(page, 'f2', 'left')).toBe('20px')
  await expect.poll(() => style(page, 'f3', 'left')).toBe('20px')
})

test('free 布局：统一尺寸(▦) 把组内宽高都改成最大值', async ({ page, request }) => {
  await open(page, request)
  await selectThree(page)

  await page.getByTestId('align-uniform').click()

  // 组内最大宽高 = f2 的 160×60
  await expect.poll(() => style(page, 'f1', 'width')).toBe('160px')
  await expect.poll(() => style(page, 'f1', 'height')).toBe('60px')
  await expect.poll(() => style(page, 'f3', 'width')).toBe('160px')
  await expect.poll(() => style(page, 'f3', 'height')).toBe('60px')
})

/**
 * flex 布局下的「▦ 统一尺寸」—— 2026-09-17 补。
 *
 * `alignFlex` 对 uniform 明确返回 null（"flex 下不适用"），而工具栏的 flex 分支
 * `if (styleChange)` 就直接跳过了 → 按钮**点了等于没点**（和 free 那条一样，是"看起来能用、
 * 实际空转"）。这里按与 free 相同的语义要求：把组内每个子节点的宽高改成组内最大值。
 */
const FLEX_DESIGN = {
  id: 'root',
  type: 'frame',
  style: { layout: 'row', width: 600, padding: 16, gap: 12, background: '#FFFFFF' },
  children: [
    { id: 'x1', type: 'component', componentType: 'button', props: { text: 'A' }, style: { width: 120, height: 40 } },
    { id: 'x2', type: 'component', componentType: 'button', props: { text: 'B' }, style: { width: 160, height: 60 } },
    { id: 'x3', type: 'component', componentType: 'button', props: { text: 'C' }, style: { width: 100, height: 40 } },
  ],
}

async function openFlex(page: Page, request: APIRequestContext) {
  const login = await request.post(`${API}/api/auth/login`, { data: { username: 'demo', password: 'demo123' } })
  const token = (await login.json()).token as string
  const created = await request.post(`${API}/api/designs`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { name: `E2E对齐-flex-${Date.now()}`, design: FLEX_DESIGN },
  })
  const id = (await created.json()).id as number
  await page.goto(`/workspace?design=${id}`)
  if (await page.getByTestId('login-password').isVisible().catch(() => false)) {
    await page.getByTestId('login-password').fill('demo123')
    await page.getByTestId('login-submit').click()
  }
  await expect(page.getByTestId('workspace-page')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId('node-x1')).toBeVisible({ timeout: 15_000 })
}

test('flex 布局：统一尺寸(▦) 同样把组内宽高改成最大值（此前是空转）', async ({ page, request }) => {
  await openFlex(page, request)
  await page.getByTestId('node-x1').click()
  await page.getByTestId('node-x2').click({ modifiers: ['Control'] })
  await page.getByTestId('node-x3').click({ modifiers: ['Control'] })
  await expect(page.getByTestId('multi-select-panel')).toContainText('已选 3 个节点')

  await page.getByTestId('align-uniform').click()

  // 组内最大宽高 = x2 的 160×60
  await expect.poll(() => style(page, 'x1', 'width')).toBe('160px')
  await expect.poll(() => style(page, 'x1', 'height')).toBe('60px')
  await expect.poll(() => style(page, 'x3', 'width')).toBe('160px')
  await expect.poll(() => style(page, 'x3', 'height')).toBe('60px')
})

/**
 * 分布：flex 主轴上的等间距 = `justify-content: space-between`
 * （同样此前是空转：`alignFlex` 对 hspace/vspace 返回 null）。
 */
test('flex 行布局：水平等间距(↔) 落到父容器 justify-content: space-between', async ({ page, request }) => {
  await openFlex(page, request)
  await page.getByTestId('node-x1').click()
  await page.getByTestId('node-x2').click({ modifiers: ['Control'] })
  await page.getByTestId('node-x3').click({ modifiers: ['Control'] })
  await expect(page.getByTestId('multi-select-panel')).toContainText('已选 3 个节点')

  await page.getByTestId('align-hspace').click()

  await expect
    .poll(() => page.locator('[data-node-id="root"]').evaluate((el) => (el as HTMLElement).style.justifyContent))
    .toBe('space-between')
})
