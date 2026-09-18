import { expect, test } from '@playwright/test'

/**
 * T4 前置/T4 批1 回归：锁定期 AI 落地闸门（真实浏览器 + 真实后端 mock 链路）。
 *
 * mock 模式（T4 前置后）增量修改产出确定性改写树：
 * - 「给卡片加个阴影」→ 第一个 component 节点 style.shadow = 预置「轻」（闸门放行）；
 * - 「把主标题改成 …」→ 第一个 text 节点 props.text 改写（锁定态闸门拒绝，文案变更）。
 *
 * 三条链路：锁定+加阴影=通过 / 锁定+改文案=拒绝（画布不变+可读提示） / 未锁定+改文案=落地。
 * 前置：后端 :8000 + Vite :5173 + y-websocket :1234。
 */

const ORIGINAL_SUB_TEXT = '满减优惠券，先到先得，每人限领 3 张'
const MOCK_EDIT_TEXT = '已按你的要求修改文案（演示模式）'

let RUN = 'gate-' + Math.random().toString(36).slice(2, 8)

async function openWorkspace(page: import('@playwright/test').Page, session: string) {
  await page.goto(`/workspace?session=${session}&from=demo&demo=coupon-root&room=e2e-${session}`)
  if (await page.getByTestId('login-password').isVisible().catch(() => false)) {
    await page.getByTestId('login-password').fill('demo123')
    await page.getByTestId('login-submit').click()
  }
  await expect(page.getByTestId('workspace-page')).toBeVisible({ timeout: 15_000 })
  // 画布加载完成：示例稿节点可见
  await expect(page.getByTestId('node-coupon-sub')).toHaveText(ORIGINAL_SUB_TEXT, { timeout: 15_000 })
}

async function confirmLayout(page: import('@playwright/test').Page) {
  await page.getByTestId('activity-beautify').click()
  await expect(page.getByTestId('beautify-panel')).toBeVisible()
  await page.getByTestId('beautify-confirm').click()
  await expect(page.getByTestId('beautify-confirmed')).toBeVisible({ timeout: 15_000 })
  await page.getByTestId('activity-ai').click()
  await expect(page.getByTestId('chat-input')).toBeVisible()
}

async function chat(page: import('@playwright/test').Page, text: string) {
  await page.getByTestId('chat-input').fill(text)
  await page.getByTestId('chat-send').click()
}

test('锁定态：AI 加阴影 → 闸门通过，画布节点出现预置 box-shadow', async ({ page }) => {
  test.setTimeout(120_000)
  const session = `s-${RUN}-shadow`
  await openWorkspace(page, session)
  await confirmLayout(page)

  await chat(page, '给卡片加个阴影')
  await expect(page.getByText(/已应用修改 ✓/)).toBeVisible({ timeout: 20_000 })

  // 画布第一个 component（coupon-title）出现内联 box-shadow，且为预置「轻」的量级。
  // 落地后 5s 内变更节点带琥珀色高亮环（会盖住 box-shadow 的计算值），等它消退再断言。
  await page.waitForFunction(
    () =>
      (getComputedStyle(document.querySelector('[data-testid="node-coupon-title"]') as Element).boxShadow || '').includes(
        '0px 4px 12px',
      ),
    { timeout: 12_000 },
  )
  const shadow = await page.getByTestId('node-coupon-title').evaluate((el) => getComputedStyle(el).boxShadow)
  expect(shadow).toContain('0px 4px 12px')
  expect(shadow).toContain('rgba(29, 33, 41, 0.1)')
  // 闸门放行后文案未被误改
  await expect(page.getByTestId('node-coupon-sub')).toHaveText(ORIGINAL_SUB_TEXT)
})

test('锁定态：AI 改文案 → 闸门拒绝，画布文案不变 + 可读提示', async ({ page }) => {
  test.setTimeout(120_000)
  const session = `s-${RUN}-reject`
  await openWorkspace(page, session)
  await confirmLayout(page)

  await chat(page, '把主标题改成 E2E 演示文案')
  await expect(page.getByText(/版面锁拒绝/)).toBeVisible({ timeout: 20_000 })
  await expect(page.getByText(/已阻止/)).toBeVisible() // 工作台横幅（同源提示）

  // 画布文案保持原样，AI 的改写未落地
  await expect(page.getByTestId('node-coupon-sub')).toHaveText(ORIGINAL_SUB_TEXT)
  await expect(page.getByText(MOCK_EDIT_TEXT)).toHaveCount(0)
})

test('未锁定：AI 改文案 → 正常落地（对照组）', async ({ page }) => {
  test.setTimeout(120_000)
  const session = `s-${RUN}-open`
  await openWorkspace(page, session)

  await page.getByTestId('activity-ai').click()
  await expect(page.getByTestId('chat-input')).toBeVisible()
  await chat(page, '把主标题改成 E2E 演示文案')
  await expect(page.getByText(/已应用修改 ✓/)).toBeVisible({ timeout: 20_000 })

  // 未锁定：AI 的改写直接落地
  await expect(page.getByTestId('node-coupon-sub')).toHaveText(MOCK_EDIT_TEXT, { timeout: 15_000 })
})

test('缺口 §4.6：锁定态「给所有卡片加阴影」（裸加句式）→ 守卫放行 + 闸门通过', async ({ page }) => {
  test.setTimeout(120_000)
  const session = `s-${RUN}-batchguard`
  await openWorkspace(page, session)
  await confirmLayout(page)

  // 该句式曾被前端守卫 isDesignRequest 误拦（"AI 拒答"，请求未发出）；
  // 修复后应到达后端（后端守卫同口径放行）→ mock 关键词规则落预置「轻」→ 闸门放行
  await chat(page, '给所有卡片加阴影')
  await expect(page.getByText(/已应用修改 ✓/)).toBeVisible({ timeout: 20_000 })
  await expect(page.getByText(/AI 设计助手，只负责/)).toHaveCount(0) // 未被守卫拒答
  await expect(page.getByTestId('node-coupon-title')).toHaveAttribute('style', /box-shadow/, { timeout: 15_000 })
})

/**
 * 2026-09-18 补：**锁定 → 解除** 的往返（用户实测报过"点了确认版面之后变成解除绑定，
 * 再按几次都没变化"）。锁的权威在服务端（`design_locks` 表，闸门据此判定），
 * 所以"解锁按钮到底生效没有"必须用**服务端行为**来验，而不是看按钮文字变了没有：
 * 解锁后同一条被拒过的指令要能落地；刷新页面后仍应是解锁态（不是本地 state 假象）。
 */
test('版面锁定可解除：解锁后同样的指令能落地，刷新后仍是解锁态（服务端权威）', async ({ page }) => {
  test.setTimeout(150_000)
  const session = `s-${RUN}-unlock`
  await openWorkspace(page, session)
  await confirmLayout(page)

  // ① 锁定态：改文案被闸门拒绝（给下面的"解锁后能落地"做对照）
  await chat(page, '把主标题改成 E2E 文案')
  await expect(page.getByText(/版面锁拒绝/)).toBeVisible({ timeout: 20_000 })
  await expect(page.getByTestId('node-coupon-sub')).toHaveText(ORIGINAL_SUB_TEXT)

  // ② 解除锁定：面板回到"确认版面"态
  await page.getByTestId('activity-beautify').click()
  await page.getByTestId('beautify-unlock').click()
  await expect(page.getByTestId('beautify-confirm')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId('beautify-confirmed')).toHaveCount(0)

  // ③ 同一条指令现在必须能落地 —— 说明服务端闸门真的开了（不是只改了按钮文字）
  await page.getByTestId('activity-ai').click()
  await chat(page, '把主标题改成 E2E 文案')
  await expect(page.getByText(/已应用修改 ✓/)).toBeVisible({ timeout: 20_000 })
  await expect(page.getByTestId('node-coupon-sub')).toHaveText(MOCK_EDIT_TEXT, { timeout: 15_000 })

  // ④ 刷新后仍是解锁态（锁状态读自服务端 design_locks，不是内存里的 layoutLocked）
  await page.reload()
  await expect(page.getByTestId('workspace-page')).toBeVisible({ timeout: 15_000 })
  await page.getByTestId('activity-beautify').click()
  await expect(page.getByTestId('beautify-confirm')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId('beautify-confirmed')).toHaveCount(0)
})
