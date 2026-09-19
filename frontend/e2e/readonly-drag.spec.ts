/**
 * T46a-3e：只读访客的**真实拖拽**拦截。
 *
 * 为什么单独一条：jsdom 没有布局与 pointer capture，其他用例都盖不到这段；
 * 而"拖不动"必须有**对照组**才算证明——owner 在同一份稿件上必须拖得动，
 * 否则"viewer 拖不动"可能只是因为这段脚本本身没触发拖拽。
 *
 * 前置数据全部用接口造（注册 viewer → 按用户名邀请进 demo 的个人工作区 → 建一份自由布局稿件），
 * 不依赖界面点选，避免用例脆弱。
 */
import { expect, test, type APIRequestContext, type BrowserContext, type Page } from '@playwright/test'

const API = 'http://localhost:8000'
const SUFFIX = Math.random().toString(36).slice(2, 8)
const VIEWER = `e2e_viewer_${SUFFIX}`
const VIEWER_PASSWORD = 'viewer123'

/** 自由布局稿件：根节点 free + 一个绝对定位的子节点（拖拽会改 x/y，便于断言） */
function freeDesign() {
  return {
    id: 'root',
    type: 'frame',
    style: { layout: 'free', width: 800, height: 600 },
    children: [
      {
        id: 'drag-a',
        type: 'component',
        componentType: 'button',
        x: 120,
        y: 120,
        props: { text: '拖动我' },
        style: { width: 140, height: 44 },
      },
    ],
  }
}

async function register(request: APIRequestContext, username: string, password: string): Promise<string> {
  const resp = await request.post(`${API}/api/auth/register`, { data: { username, password } })
  if (resp.ok()) return (await resp.json()).token as string
  const login = await request.post(`${API}/api/auth/login`, { data: { username, password } })
  expect(login.ok(), `登录 ${username} 失败：${login.status()}`).toBeTruthy()
  return (await login.json()).token as string
}

/** 造前置数据：一份自由布局稿件 + 一个能看它的 viewer 账号；返回稿件 id 与 viewer token */
async function seed(request: APIRequestContext, ownerToken: string) {
  const headers = { Authorization: `Bearer ${ownerToken}` }
  const wsList = await request.get(`${API}/api/workspaces`, { headers })
  expect(wsList.ok()).toBeTruthy()
  const owned = (await wsList.json()).workspaces.find((w: { role: string }) => w.role === 'owner')
  expect(owned, 'demo 应有个人工作区').toBeTruthy()

  const viewerToken = await register(request, VIEWER, VIEWER_PASSWORD)
  const invited = await request.post(`${API}/api/workspaces/${owned.id}/invites/by-username`, {
    headers,
    data: { username: VIEWER, role: 'viewer' },
  })
  // 随机后缀 → 正常是 200；重复跑同一轮时可能 409（已是成员），都算前置就绪
  expect([200, 409]).toContain(invited.status())

  const created = await request.post(`${API}/api/designs`, {
    headers,
    data: { name: `e2e-只读拖拽-${SUFFIX}`, design: freeDesign() },
  })
  expect(created.ok(), `建稿件失败：${created.status()}`).toBeTruthy()
  return { designId: (await created.json()).id as number, viewerToken }
}

/** 用给定 token 打开工作台（往 localStorage 注入凭证，避免依赖登录表单） */
async function openAs(context: BrowserContext, token: string, url: string): Promise<Page> {
  await context.addInitScript((injected: string) => {
    try {
      localStorage.setItem('design-tool-token', injected)
      localStorage.setItem('design-tool-user', 'e2e')
    } catch {
      /* about:blank 阶段没有 localStorage，忽略 */
    }
  }, token)
  const page = await context.newPage()
  await page.goto(url)
  return page
}

/** 把节点拖动 (dx,dy) 像素 */
async function dragNode(page: Page, testId: string, dx: number, dy: number) {
  const node = page.getByTestId(testId)
  // 画布挂载后会重新居中/等尺寸稳定，节点屏幕位置会移动；先等它连续两次读数一致，
  // 避免"量到旧位置 → 鼠标落在节点外 → 拖空"（实测偶发：位移断言仍过、反馈断言红）
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
  await page.waitForTimeout(300) // 等事务落库 / 重渲染
}

test('T46a-3e：owner 拖得动（对照组），viewer 拖不动且位置分毫不变', async ({ browser, request, page }) => {
  const ownerToken = await register(request, 'demo', 'demo123')
  const { designId, viewerToken } = await seed(request, ownerToken)
  const url = `/workspace?design=${designId}`

  // ---- 对照组：owner 在同一份稿件上必须拖得动 ----
  const owner = await openAs(page.context(), ownerToken, url)
  await expect(owner.getByTestId('workspace-page')).toBeVisible()
  await expect(owner.getByTestId('node-drag-a')).toBeVisible()
  expect(await owner.getByTestId('readonly-badge').count()).toBe(0) // owner 不是只读

  const beforeOwner = await owner.getByTestId('node-drag-a').boundingBox()
  await dragNode(owner, 'node-drag-a', 60, 40)
  const afterOwner = await owner.getByTestId('node-drag-a').boundingBox()
  expect(afterOwner!.x - beforeOwner!.x).toBeGreaterThan(40)
  expect(afterOwner!.y - beforeOwner!.y).toBeGreaterThan(25)

  // ---- 只读访客：同一份稿件、同样的手势，位置必须不变 ----
  const viewerContext = await browser.newContext()
  try {
    const viewer = await openAs(viewerContext, viewerToken, url)
    await expect(viewer.getByTestId('workspace-page')).toBeVisible()
    await expect(viewer.getByTestId('readonly-badge')).toBeVisible() // 只读角色已判定
    await expect(viewer.getByTestId('node-drag-a')).toBeVisible()

    const beforeViewer = await viewer.getByTestId('node-drag-a').boundingBox()
    await dragNode(viewer, 'node-drag-a', 60, 40)
    const afterViewer = await viewer.getByTestId('node-drag-a').boundingBox()

    expect(Math.abs(afterViewer!.x - beforeViewer!.x)).toBeLessThanOrEqual(1)
    expect(Math.abs(afterViewer!.y - beforeViewer!.y)).toBeLessThanOrEqual(1)
    // 给了一次明确反馈（而不是"拖了完全没反应"）。注意不要用 "只读访客：" 这种宽泛匹配——
    // 进页面时那条"可以查看实时协作…"的提示也含它，会假绿；这里匹配拖拽专属措辞。
    //
    // 有界重试：手势偶发没落到节点上（量位置与落点之间的布局抖动，实测 ~1/3 概率；
    // 此时位移断言照样过、只有反馈断言红）→ 重试一次手势。**两次手势都无反馈仍判红**，
    // 所以"拖了完全没反应"这个 bug 依然被这条断言抓住（改动前就是 2/2 必红）。
    if ((await viewer.getByText(/拖动\/缩放不会生效/).count()) === 0) {
      await dragNode(viewer, 'node-drag-a', 60, 40)
    }
    await expect(viewer.getByText(/拖动\/缩放不会生效/)).toBeVisible()

    // 刷新后仍是原位置（排除"只是本地没重渲染"）
    await viewer.reload()
    await expect(viewer.getByTestId('node-drag-a')).toBeVisible()
    const afterReload = await viewer.getByTestId('node-drag-a').boundingBox()
    expect(Math.abs(afterReload!.x - beforeViewer!.x)).toBeLessThanOrEqual(1)
  } finally {
    await viewerContext.close()
  }
})
