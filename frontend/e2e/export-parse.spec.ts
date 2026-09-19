/**
 * 导出产物的**端到端语法守门**（2026-09-18）。
 *
 * 单元级守门（`src/export/exportSyntax.test.ts`）跑的是手写稿；这条走**真实链路**：
 * 8 个模板稿 → 工作台 → 「⬇ 导出代码」→ 读对话框里展示的 `src/App.tsx` → 交给 TS 解析器。
 *
 * 为什么值得单独一条：导出是交付物（"设计稿直接导出 React"），产物编译不过就等于交付废品；
 * 而 2026-09-16 那次 P0（`style={{{…}}}` 三层花括号）恰恰是"功能测试全绿、产物编译不过"。
 * 对话框里展示的代码与 ZIP 内的代码同源（ADR-002 单一同源），所以读面板即验交付物。
 *
 * 前置：后端 :8000（mock）+ Vite :5173。
 */
import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import ts from 'typescript'

const API = 'http://localhost:8000'

/** 只做语法解析（不查类型）：TSX 模式，否则 `<div>` 会被当成类型断言 */
function syntaxErrors(code: string): string[] {
  const source = ts.createSourceFile('App.tsx', code, ts.ScriptTarget.Latest, false, ts.ScriptKind.TSX)
  const diagnostics =
    (source as unknown as { parseDiagnostics?: Array<{ messageText: unknown }> }).parseDiagnostics ?? []
  return diagnostics.map((d) => ts.flattenDiagnosticMessageText(d.messageText as never, ' / '))
}

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

test('8 个模板导出 React：产物零语法错（面板代码 == 交付物）', async ({ page, request }) => {
  test.setTimeout(180_000)
  const token = (await (await request.post(`${API}/api/auth/login`, { data: { username: 'demo', password: 'demo123' } })).json()).token as string
  const list = (await (await request.get(`${API}/api/generate/templates`, { headers: { Authorization: `Bearer ${token}` } })).json())
    .templates as Array<{ key: string; name: string }>

  const failures: string[] = []
  for (const t of list) {
    const detail = await (
      await request.get(`${API}/api/generate/templates/${t.key}`, { headers: { Authorization: `Bearer ${token}` } })
    ).json()
    const id = await createDesign(request, token, detail.design, `E2E导出守门-${t.key}-${Date.now()}`)
    await openWorkspace(page, id)
    await expect(page.getByTestId(`node-${detail.design.id}`)).toBeVisible({ timeout: 15_000 })

    await page.getByTestId('export-code').click()
    await expect(page.getByTestId('export-dialog')).toBeVisible()
    // 必须读 `code-body`：整个面板的 textContent 会把左侧**行号列**也拼进来（`1` `2` `3`…），
    // 拼成的不是代码（第一版就是这么误报的）。code-body 才是真正的代码文本。
    const code = (await page.getByTestId('export-code-panel').getByTestId('code-body').textContent()) ?? ''
    await page.getByTestId('export-close').click()

    // 面板必须真有内容（否则"零语法错"可能只是因为读到空字符串）
    if (!code.includes('export default function App')) {
      failures.push(`${t.key}：面板里没有 export default function App（只读到 ${code.length} 字符）`)
      continue
    }
    const errs = syntaxErrors(code)
    if (errs.length) failures.push(`${t.key}：${errs.slice(0, 3).join(' / ')}`)
  }
  expect(failures, '8 个模板的导出产物语法检查').toEqual([])
})
