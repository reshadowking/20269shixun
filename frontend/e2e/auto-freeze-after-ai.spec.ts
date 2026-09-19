/**
 * 需求原话："我需要 ai 生成的默认就是可以编辑的……不要多余一步去转自由画布。"
 *
 * 机制：8 个模板骨架全是 flex（column/row）——拖动只能重排顺序，不能任意摆放；
 * 生成落地后由 `autoFreezeAfterAi()` 自动冻结一次（DOM 测量 → 写 x/y/宽高），画布转 free。
 * 这条机制此前**只有守卫的单测**（`lib/autoFreeze.test.ts` 测 canAutoFreeze），
 * 没人从用户视角验过"生成完到底能不能直接拖"。
 *
 * 本用例走真实链路：AI 生成 → **不点「转自由画布」** → 直接拖顶层节点 → 位置真的变了。
 * 对照组性质：flex 下同一个手势只会重排（x 不变），所以这条断言能区分"冻成了 free"与"还是 flex"。
 *
 * 前置：后端 :8000（mock）+ Vite :5173。
 */
import { expect, test, type Page } from '@playwright/test'

/** 拖动节点 (dx,dy) 像素；先等位置连续两次读数一致，避免"量到旧位置 → 拖空" */
async function dragNode(page: Page, testId: string, dx: number, dy: number) {
  const node = page.getByTestId(testId)
  let prev = ''
  for (let i = 0; i < 20; i++) {
    const b = await node.boundingBox()
    const key = b ? `${Math.round(b.x)},${Math.round(b.y)}` : ''
    if (key && key === prev) break
    prev = key
    await page.waitForTimeout(150)
  }
  const box = await node.boundingBox()
  expect(box, `找不到节点 ${testId} 的位置`).toBeTruthy()
  const cx = box!.x + box!.width / 2
  const cy = box!.y + box!.height / 2
  await page.mouse.move(cx, cy)
  await page.mouse.down()
  await page.mouse.move(cx + dx, cy + dy, { steps: 10 })
  await page.mouse.up()
  await page.waitForTimeout(300) // 等事务落地 / 重渲染
}

test('AI 生成后即可自由摆放：不用点「转自由画布」', async ({ page }) => {
  test.setTimeout(120_000)
  const tag = Math.random().toString(36).slice(2, 8)

  await page.goto(`/workspace?session=s-af${tag}&from=blank`)
  if (await page.getByTestId('login-password').isVisible().catch(() => false)) {
    await page.getByTestId('login-password').fill('demo123')
    await page.getByTestId('login-submit').click()
  }
  await expect(page.getByTestId('workspace-page')).toBeVisible({ timeout: 15_000 })

  // AI 生成（mock 即时返回登录模板）
  await page.getByTestId('activity-ai').click()
  await page.getByTestId('chat-input').fill('设计一个登录页面，简洁现代风格')
  await page.getByTestId('chat-send').click()
  await expect(page.getByTestId('node-login-root')).toBeVisible({ timeout: 30_000 })

  // 生成落地后自动冻结：布局从 flex 变成 free（以前这一步要用户手动点按钮）
  await expect(page.getByTestId('design-canvas')).toHaveAttribute('data-yjs-layout', 'free', { timeout: 20_000 })

  // 直接拖顶层子节点：位置真的变了（flex 下 x 由布局决定，会原地不动）
  const title = page.getByTestId('node-login-title')
  const before = await title.boundingBox()
  await dragNode(page, 'node-login-title', 150, 120)
  const after = await title.boundingBox()
  expect(after!.x - before!.x, '水平位移（flex 下会是 0）').toBeGreaterThan(100)
  expect(after!.y - before!.y, '垂直位移').toBeGreaterThan(80)

  // 冻结不是"把画布改乱"：根节点与拖过的节点都还在，且仍可选中
  await expect(page.getByTestId('node-login-root')).toBeVisible()
  await expect(page.getByTestId('node-login-btn')).toBeVisible()
  await page.getByTestId('node-login-btn').click()
  await expect(page.getByTestId('selection-count')).toContainText('已选 1 个节点')
})

test('嵌套容器里的节点同样能直接拖（不只第一层）', async ({ page }) => {
  test.setTimeout(120_000)
  const tag = Math.random().toString(36).slice(2, 8)

  await page.goto(`/workspace?session=s-afn${tag}&from=blank`)
  if (await page.getByTestId('login-password').isVisible().catch(() => false)) {
    await page.getByTestId('login-password').fill('demo123')
    await page.getByTestId('login-submit').click()
  }
  await expect(page.getByTestId('workspace-page')).toBeVisible({ timeout: 15_000 })

  // 电商模板有嵌套容器：ecommerce-root → ecom-coupons（row）→ ecom-c1/c2/c3。
  // 注意：prompt 里要带风格，否则会先走「追问」流程（welcome 文案里的示例就是这个句式）。
  await page.getByTestId('activity-ai').click()
  await page.getByTestId('chat-input').fill('设计一个电商优惠券领取页，红色调，圆角风格')
  await page.getByTestId('chat-send').click()
  await expect(page.getByTestId('node-ecommerce-root')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByTestId('design-canvas')).toHaveAttribute('data-yjs-layout', 'free', { timeout: 20_000 })

  // 竖直方向拖第一张券：
  //   父容器还是 flex（只冻第一层的旧行为）→ row 的交叉轴位置由布局决定，拖了不会动；
  //   父容器已冻成 free（本次改法）→ y 真的跟着走。
  const coupon = page.getByTestId('node-ecom-c1')
  const before = await coupon.boundingBox()
  await dragNode(page, 'node-ecom-c1', 0, 170)
  const after = await coupon.boundingBox()
  expect(after!.y - before!.y, '嵌套节点的垂直位移（flex row 下会是 0）').toBeGreaterThan(120)
})
