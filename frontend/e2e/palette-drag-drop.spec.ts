/**
 * 组件库**拖拽**到画布（2026-09-18）。
 *
 * 组件库面板自己写着"点击添加，或拖拽到画布任意位置"——但此前所有 E2E 都只**点击**添加
 * （`palette-button` / `palette-image`），“拖拽”这条路径完全没有覆盖：
 * HTML5 拖放要靠 `dataTransfer` 传 `application/design-component`，一旦格式串、拖拽开始回调
 * 或画布 drop 处理器哪一处坏了，UI 上仍会显示"可以拖拽"这句承诺，用户拖半天没反应也没人发现。
 *
 * 前置：后端 :8000（mock）+ Vite :5173。
 */
import { expect, test, type Page } from '@playwright/test'

async function openWorkspace(page: Page, session: string) {
  await page.goto(`/workspace?session=${session}&from=blank`)
  if (await page.getByTestId('login-password').isVisible().catch(() => false)) {
    await page.getByTestId('login-password').fill('demo123')
    await page.getByTestId('login-submit').click()
  }
  await expect(page.getByTestId('workspace-page')).toBeVisible({ timeout: 15_000 })
}

test('拖拽组件库到画布：真的新增一个节点（不是只承诺了"可以拖"）', async ({ page }) => {
  test.setTimeout(90_000)
  const tag = Math.random().toString(36).slice(2, 8)
  await openWorkspace(page, `s-pd${tag}`)

  const nodes = page.locator('[data-testid="canvas-sheet"] [data-node-id]')
  const before = await nodes.count()

  // HTML5 拖放：Playwright 的 dragAndDrop 会带上 dataTransfer（Chromium 支持）
  await page.dragAndDrop('[data-testid="palette-button"]', '[data-testid="canvas-sheet"]')

  await expect(nodes).toHaveCount(before + 1, { timeout: 10_000 })
  // 新节点必须真的画在画布上（可见），且能在图层树里找到（进了设计树，不是纯 DOM 残留）
  await page.getByTestId('activity-layers').click()
  await expect(page.getByTestId('layer-tree')).toBeVisible()
  // 图层树里只有"节点行"带 draggable（toggle/hide/children 容器都不是），用它数一遍：
  // 与画布节点数一致即说明新节点真的进了设计树，而不只是屏幕上的 DOM 残留
  await expect(page.getByTestId('layer-tree').locator('div[draggable="true"]')).toHaveCount(before + 1, {
    timeout: 10_000,
  })
})

test('拖拽到 50% 缩放下的画布：落点按画布坐标换算（不会飘到别处）', async ({ page }) => {
  test.setTimeout(90_000)
  const tag = Math.random().toString(36).slice(2, 8)
  await openWorkspace(page, `s-pd2${tag}`)

  // 缩到 50% 再拖：画布坐标 = 屏幕像素 / scale，写错就会出现"拖到左边却落在右边"
  await page.getByTestId('zoom-0.5').click()
  const sheet = (await page.getByTestId('canvas-sheet').boundingBox())!
  const nodes = page.locator('[data-testid="canvas-sheet"] [data-node-id]')
  const before = await nodes.count()

  await page.dragAndDrop('[data-testid="palette-button"]', '[data-testid="canvas-sheet"]', {
    targetPosition: { x: sheet.width * 0.5, y: sheet.height * 0.5 },
  })
  await expect(nodes).toHaveCount(before + 1, { timeout: 10_000 })

  // 新节点应当落在画布（纸张）范围内
  const inner = await page.locator('[data-testid="canvas-sheet"] [data-node-id]').last().boundingBox()
  expect(inner!.x).toBeGreaterThanOrEqual(sheet.x - 2)
  expect(inner!.y).toBeGreaterThanOrEqual(sheet.y - 2)
  expect(inner!.x).toBeLessThanOrEqual(sheet.x + sheet.width + 2)
  expect(inner!.y).toBeLessThanOrEqual(sheet.y + sheet.height + 2)
})
