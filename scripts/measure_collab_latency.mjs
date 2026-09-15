/**
 * 协作同步延迟测量（缺口 P0-2 / 任务 T-P0-2）
 *
 * 目的：为源文档四大指标中唯一空白的「设计协作同步延迟 ≤200ms」提供实测数据。
 *
 * 口径（写进报告时必须带上，否则数字没意义）：
 * - 测量对象：**同机双标签**（同一浏览器、同一 room），loopback 环境；
 * - 触发动作：A 页在属性面板修改选中节点的「宽度」，B 页观察到该节点 DOM 宽度改变；
 * - 计时位置：Node 侧 `Date.now()`，**含自动化驱动开销（约数 ms）**；
 * - 采样：默认 30 次，输出 P50 / P95 / min / max。
 *
 * 前置：
 *   1) 后端 :8000 与前端 :5173 已启动；
 *   2) 已安装 Playwright 浏览器（frontend 目录下 `npx playwright install chromium`）；
 *   3) y-websocket 容器可选——缺失时 aware/内容同步不可用，脚本会失败并提示。
 *
 * 运行：
 *   cd frontend
 *   node ../scripts/measure_collab_latency.mjs
 *   MEASURE_ITERS=50 node ../scripts/measure_collab_latency.mjs
 *
 * 输出：控制台统计 + 写入 `docs/reverse/collab-latency.json`
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '..')

const BASE = process.env.MEASURE_BASE ?? 'http://localhost:5173'
const ITERS = Number(process.env.MEASURE_ITERS ?? 30)
const ROOM = 'latency-' + Math.random().toString(36).slice(2, 8)
const SESSION = 's-latency1'

/** Playwright 从 frontend/node_modules 解析（在仓库任意目录运行都能找到） */
const requireFromFrontend = createRequire(resolve(repoRoot, 'frontend/package.json'))
const { chromium } = requireFromFrontend('playwright')

function percentile(sorted, p) {
  if (sorted.length === 0) return null
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)
  return sorted[Math.max(0, idx)]
}

/** 分步执行 + 失败时标注步骤名（便于定位到底是登录、工作台还是画布的问题） */
async function step(label, fn) {
  try {
    return await fn()
  } catch (err) {
    throw new Error(`[步骤失败: ${label}] ${String(err?.message ?? err).split('\n')[0]}`)
  }
}

async function login(page, tag) {
  // 先走登录页，再进工作台（不依赖 redirect 行为，减少环境差异）
  await step(`${tag} 打开登录页`, async () => {
    await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
  })
  await step(`${tag} 提交登录`, async () => {
    const pwd = page.getByTestId('login-password')
    if (await pwd.isVisible().catch(() => false)) {
      await pwd.fill('demo123')
      await page.getByTestId('login-submit').click()
    }
    await page.waitForFunction(() => !location.pathname.startsWith('/login'), null, { timeout: 15000 })
  })
  await step(`${tag} 进入工作台`, async () => {
    await page.goto(`${BASE}/workspace?room=${ROOM}&session=${SESSION}`, { waitUntil: 'domcontentloaded' })
    await page.getByTestId('workspace-page').waitFor({ state: 'visible', timeout: 20000 })
  })
  await step(`${tag} 等待画布渲染`, async () => {
    await page.getByTestId('canvas-sheet').waitFor({ state: 'visible', timeout: 20000 })
  })
}

/** 取画布上第一个非根节点的 id（用 data-node-id 属性，避免依赖具体设计内容） */
async function pickNodeId(page) {
  return page.evaluate(() => {
    const nodes = Array.from(document.querySelectorAll('[data-node-id]'))
    // 第一个通常是根 frame；取第二个（若无则退回第一个）
    const el = nodes[1] ?? nodes[0]
    return el ? el.getAttribute('data-node-id') : null
  })
}

let browser
try {
  browser = await chromium.launch()
} catch (err) {
  console.error('\n❌ 无法启动浏览器：', String(err?.message ?? err).split('\n')[0])
  console.error('   常见原因：')
  console.error('     1) 当前环境禁止启动浏览器进程（报 spawn EPERM）→ 请在可运行 Chromium 的机器上执行；')
  console.error('     2) 未安装浏览器 → cd frontend && npx playwright install chromium')
  process.exit(1)
}
const context = await browser.newContext()
const pageA = await context.newPage()
const pageB = await context.newPage()

/** 浏览器侧诊断信息（出错时打印，便于定位是应用问题还是脚本问题） */
const consoleLogs = []
for (const [name, p] of [
  ['A', pageA],
  ['B', pageB],
]) {
  p.on('console', (m) => {
    if (m.type() === 'error') consoleLogs.push(`[${name}] console.error: ${m.text()}`)
  })
  p.on('pageerror', (e) => consoleLogs.push(`[${name}] pageerror: ${String(e?.message ?? e).split('\n')[0]}`))
}

const samples = []
let failedReason = null

try {
  await login(pageA)
  await login(pageB)

  const nodeId = await step('读取画布节点', async () => {
    const id = await pickNodeId(pageA)
    if (!id) throw new Error('画布上找不到任何节点（data-node-id 为空）')
    return id
  })

  console.log(`  目标节点：${nodeId}`)
  // 在 A 页选中该节点（走图层树：比点画布元素稳——画布元素带 transform、且可能被遮罩覆盖）
  await step(`选中节点 ${nodeId}`, async () => {
    await pageA.getByTestId('activity-layers').click()
    const row = pageA.getByTestId(`layer-${nodeId}`).first()
    await row.waitFor({ state: 'attached', timeout: 15000 })
    // 强制点击：跳过"可接收事件"检查（图层行可能被浮层/滚动容器遮挡判定影响），
    // 我们只需要它触发选中事件即可
    await row.click({ force: true, timeout: 15000 })
    await pageA.getByTestId('activity-props').click()
    await pageA.getByTestId('prop-width').waitFor({ state: 'visible', timeout: 15000 })
  })

  for (let i = 0; i < ITERS; i += 1) {
    const width = 120 + (i % 20) * 7 // 每次换一个值，确保是"新"更新
    const t0 = Date.now()

    await step(`第 ${i + 1} 次：A 页改宽度`, async () => {
      await pageA.getByTestId('prop-width').fill(String(width))
      await pageA.getByTestId('prop-width').blur()
    })

    // B 页等待该节点宽度变化（raf 轮询，取得感知延迟上界）
    await step(`第 ${i + 1} 次：B 页等待同步`, async () => {
      await pageB.waitForFunction(
        ({ id, w }) => {
          const el = document.querySelector(`[data-node-id="${id}"]`)
          if (!el) return false
          const styleW = el.style.width || ''
          return styleW.startsWith(String(w))
        },
        { id: nodeId, w: width },
        { timeout: 5000, polling: 'raf' },
      )
    })

    samples.push(Date.now() - t0)
  }
} catch (err) {
  failedReason = String(err?.message ?? err).split('\n')[0]
  // 失败时抓诊断信息（截图 + 浏览器错误日志），便于定位
  try {
    mkdirSync(resolve(repoRoot, 'docs/reverse'), { recursive: true })
    await pageA.screenshot({ path: resolve(repoRoot, 'docs/reverse/_debug-latency-A.png') }).catch(() => {})
    await pageB.screenshot({ path: resolve(repoRoot, 'docs/reverse/_debug-latency-B.png') }).catch(() => {})
    // HTML 落盘便于文本排查（截图需人工看，HTML 可直接 grep）
    writeFileSync(
      resolve(repoRoot, 'docs/reverse/_debug-latency-A.html'),
      await pageA.content().catch(() => ''),
      'utf8',
    )
    failedReason += '（已保存诊断：docs/reverse/_debug-latency-A.html + 截图）'
  } catch {
    /* 截图失败不覆盖原始错误 */
  }
} finally {
  await browser.close()
}

if (failedReason || samples.length === 0) {
  console.error('\n❌ 测量未完成：', failedReason ?? '无有效样本')
  if (consoleLogs.length > 0) {
    console.error('   浏览器侧错误（最多 8 条）：')
    consoleLogs.slice(0, 8).forEach((l) => console.error('     ' + l))
  }
  console.error('   排查：后端/前端是否已启动？y-websocket 容器是否在跑？浏览器是否已安装？')
  process.exit(1)
}

const sorted = [...samples].sort((a, b) => a - b)
const result = {
  metric: '设计协作同步延迟',
  target_ms: 200,
  measured_at: new Date().toISOString(),
  scope: '同机双标签（loopback），自动化驱动测量',
  method: 'A 页改属性面板宽度 → B 页 DOM 观察到该宽度变化',
  clock: 'Node 侧 Date.now()，含自动化开销',
  samples: samples.length,
  p50_ms: percentile(sorted, 50),
  p95_ms: percentile(sorted, 95),
  min_ms: sorted[0],
  max_ms: sorted[sorted.length - 1],
  raw: samples,
}

const outPath = resolve(repoRoot, 'docs/reverse/collab-latency.json')
mkdirSync(dirname(outPath), { recursive: true })
writeFileSync(outPath, JSON.stringify(result, null, 2), 'utf8')

console.log('\n=== 协作同步延迟测量结果 ===')
console.log(`  口径    ：${result.scope}`)
console.log(`  样本数  ：${result.samples}`)
console.log(`  P50     ：${result.p50_ms} ms`)
console.log(`  P95     ：${result.p95_ms} ms`)
console.log(`  min/max ：${result.min_ms} / ${result.max_ms} ms`)
console.log(`  目标    ：≤ ${result.target_ms} ms  →  ${result.p95_ms <= 200 ? '✅ P95 达标' : '❌ P95 超标'}`)
console.log(`  已写入  ：docs/reverse/collab-latency.json`)
