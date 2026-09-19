/**
 * 「邀请 → 对方在我的项目里看到稿件」端到端。
 *
 * 为什么单独立一条：两轮前验收抓到的正是"**权限通、界面空**"这类回归——
 * `GET /api/designs` 当时只按 owner_id 过滤，于是被邀请方登录后「我的项目」是 0 份，
 * 邀请面板却写着"你名下的设计稿对 TA 可见"。接口与单测都盖不住这条（它们各自看一半），
 * 只有"造真实邀请 → 用对方身份打开界面"才锁得住。
 *
 * 定位策略：稿名带随机后缀，页面上用**搜索框**筛出来——不受库里既有稿件数量影响。
 */
import { expect, test, type APIRequestContext, type BrowserContext } from '@playwright/test'

const API = 'http://localhost:8000'
const SUFFIX = Math.random().toString(36).slice(2, 8)
const DESIGN_NAME = `e2e-共享可见-${SUFFIX}`
const INVITEE = `e2e_invitee_${SUFFIX}`
const INVITEE_PASSWORD = 'invitee123'

const POSITIVE = {
  id: 'root',
  type: 'frame',
  style: { layout: 'column', width: 800, height: 600 },
  children: [{ id: 't1', type: 'text', props: { text: '共享可见' }, style: {} }],
}

async function register(request: APIRequestContext, username: string, password: string): Promise<string> {
  const resp = await request.post(`${API}/api/auth/register`, { data: { username, password } })
  if (resp.ok()) return (await resp.json()).token as string
  const login = await request.post(`${API}/api/auth/login`, { data: { username, password } })
  expect(login.ok(), `登录 ${username} 失败：${login.status()}`).toBeTruthy()
  return (await login.json()).token as string
}

/** 用给定 token 打开页面（注入凭证，不依赖登录表单） */
async function openAs(context: BrowserContext, token: string, path: string) {
  await context.addInitScript((injected: string) => {
    try {
      localStorage.setItem('design-tool-token', injected)
      localStorage.setItem('design-tool-user', 'e2e')
    } catch {
      /* about:blank 阶段没有 localStorage，忽略 */
    }
  }, token)
  const page = await context.newPage()
  await page.goto(path)
  return page
}

test('被邀请方登录后能在「我的项目」里看到并打开共享稿件（owner 自己不显示"由 X 共享"）', async ({
  browser,
  request,
}) => {
  // ---- 前置数据：demo 的稿件 + 一个按用户名邀请进来的 editor ----
  const ownerToken = await register(request, 'demo', 'demo123')
  const ownerHeaders = { Authorization: `Bearer ${ownerToken}` }
  const wsRows = await request.get(`${API}/api/workspaces`, { headers: ownerHeaders })
  expect(wsRows.ok()).toBeTruthy()
  const ws = (await wsRows.json()).workspaces.find((w: { role: string }) => w.role === 'owner')
  expect(ws, 'demo 应有个人工作区').toBeTruthy()

  const inviteeToken = await register(request, INVITEE, INVITEE_PASSWORD)
  const invited = await request.post(`${API}/api/workspaces/${ws.id}/invites/by-username`, {
    headers: ownerHeaders,
    data: { username: INVITEE, role: 'editor' },
  })
  expect([200, 409]).toContain(invited.status())

  const created = await request.post(`${API}/api/designs`, {
    headers: ownerHeaders,
    data: { name: DESIGN_NAME, design: POSITIVE },
  })
  expect(created.ok(), `建稿件失败：${created.status()}`).toBeTruthy()
  const designId = (await created.json()).id as number

  // ---- 对照组：owner 自己的列表里有这张卡，但**不显示**"由 X 共享" ----
  const ownerContext = await browser.newContext()
  try {
    const owner = await openAs(ownerContext, ownerToken, '/projects')
    await expect(owner.getByTestId('projects-page')).toBeVisible()
    await owner.getByTestId('projects-search').fill(DESIGN_NAME)
    await expect(owner.getByTestId(`project-card-${designId}`)).toBeVisible()
    await expect(owner.getByTestId(`project-${designId}-shared-by`)).toHaveCount(0)
    await expect(owner.getByTestId(`project-${designId}-role`)).toHaveText('所有者')
  } finally {
    await ownerContext.close()
  }

  // ---- 被邀请方：卡片必须出现，且标明"由 demo 共享"与可编辑 ----
  const inviteeContext = await browser.newContext()
  try {
    const invitee = await openAs(inviteeContext, inviteeToken, '/projects')
    await expect(invitee.getByTestId('projects-page')).toBeVisible()
    await invitee.getByTestId('projects-search').fill(DESIGN_NAME)

    await expect(invitee.getByTestId(`project-card-${designId}`)).toBeVisible()
    await expect(invitee.getByTestId(`project-${designId}-shared-by`)).toHaveText('由 demo 共享')
    await expect(invitee.getByTestId(`project-${designId}-role`)).toHaveText('可编辑')
    await expect(invitee.getByTestId(`project-${designId}-workspace`)).toBeVisible()

    // 不只是"看得到卡片"：点进去要真能打开（否则还是发现不了）
    await invitee.getByTestId(`project-open-${designId}`).click()
    await expect(invitee.getByTestId('workspace-page')).toBeVisible()
    await expect(invitee).toHaveURL(new RegExp(`design=${designId}`))
  } finally {
    await inviteeContext.close()
  }
})
