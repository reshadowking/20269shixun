/**
 * free 节点的 8 向缩放手柄 —— 2026-09-17 补的覆盖。
 *
 * 这条此前**零 E2E**（`data-resize-handle` 在 e2e 里没有任何引用），而它的数学最密：
 * 屏幕像素 → 画布单位要除以缩放、四方向的锚点还不同（`e/s` 只改尺寸，`w/n` 要同时挪原点），
 * 还得夹 MIN_SIZE。前几轮"补覆盖"已经在对齐、几何体检、右键菜单上抓到过真 bug，这条同样值得钉住。
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
    { id: 'r1', type: 'component', componentType: 'button', x: 100, y: 80, props: { text: '可缩放' }, style: { width: 200, height: 100 } },
  ],
}

function box(page: Page, nodeId: string) {
  return page.locator(`[data-node-id="${nodeId}"]`).evaluate((el) => {
    const s = (el as HTMLElement).style
    return { left: s.left, top: s.top, width: s.width, height: s.height }
  })
}

async function dragHandle(page: Page, dir: string, dx: number, dy: number) {
  const handle = page.locator(`[data-resize-handle="${dir}"]`)
  const b = (await handle.boundingBox())!
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2)
  await page.mouse.down()
  await page.mouse.move(b.x + b.width / 2 + dx, b.y + b.height / 2 + dy, { steps: 8 })
  await page.mouse.up()
}

test('free 节点：se 手柄只放大宽高，nw 手柄同时移动原点', async ({ page, request }) => {
  const login = await request.post(`${API}/api/auth/login`, { data: { username: 'demo', password: 'demo123' } })
  const token = (await login.json()).token as string
  const created = await request.post(`${API}/api/designs`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { name: `E2E缩放-${Date.now()}`, design: DESIGN },
  })
  const id = (await created.json()).id as number

  await page.goto(`/workspace?design=${id}`)
  if (await page.getByTestId('login-password').isVisible().catch(() => false)) {
    await page.getByTestId('login-password').fill('demo123')
    await page.getByTestId('login-submit').click()
  }
  await expect(page.getByTestId('workspace-page')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId('node-r1')).toBeVisible({ timeout: 15_000 })

  // 选中节点 → 手柄出现
  await page.getByTestId('node-r1').click()
  await expect(page.locator('[data-resize-handle="se"]')).toBeVisible()

  // ① se（右下）：只放大宽高，原点不动
  await dragHandle(page, 'se', 40, 30)
  await expect.poll(() => box(page, 'r1')).toEqual({ left: '100px', top: '80px', width: '240px', height: '130px' })

  // ② nw（左上）：宽高变小，同时把原点推到新位置
  await dragHandle(page, 'nw', 20, 10)
  await expect.poll(() => box(page, 'r1')).toEqual({ left: '120px', top: '90px', width: '220px', height: '120px' })
})

/**
 * 缩放**不是 100%** 时的拖拽：屏幕像素必须除以画布缩放，否则 150% 下会放大 1.5 倍。
 * 以及 MIN_SIZE（8px）夹取 —— 手柄往反方向拖过头时必须停在最小尺寸，不能变负数。
 */
test('free 节点：150% 缩放下拖拽按画布单位换算；反向拖过头夹在最小尺寸', async ({ page, request }) => {
  const login = await request.post(`${API}/api/auth/login`, { data: { username: 'demo', password: 'demo123' } })
  const token = (await login.json()).token as string
  const created = await request.post(`${API}/api/designs`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { name: `E2E缩放-zoom-${Date.now()}`, design: DESIGN },
  })
  const id = (await created.json()).id as number

  await page.goto(`/workspace?design=${id}`)
  if (await page.getByTestId('login-password').isVisible().catch(() => false)) {
    await page.getByTestId('login-password').fill('demo123')
    await page.getByTestId('login-submit').click()
  }
  await expect(page.getByTestId('node-r1')).toBeVisible({ timeout: 15_000 })
  await page.getByTestId('node-r1').click()
  await expect(page.locator('[data-resize-handle="se"]')).toBeVisible()

  // 150%：屏幕 +45/+30 应当只等于画布 +30/+20
  await page.getByTestId('zoom-1.5').click()
  await dragHandle(page, 'se', 45, 30)
  await expect.poll(() => box(page, 'r1')).toEqual({ left: '100px', top: '80px', width: '230px', height: '120px' })

  // 反向拖过头 → 夹在 MIN_SIZE（8px），原点/尺寸都不能变负
  await dragHandle(page, 'se', -500, -400)
  await expect.poll(() => box(page, 'r1')).toEqual({ left: '100px', top: '80px', width: '8px', height: '8px' })
})
