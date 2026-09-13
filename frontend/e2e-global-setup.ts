/**
 * E2E 全局准备：
 * ① 清空 y-websocket 持久化状态并重启容器（room 状态在测试间累积会导致竞态）；
 * ② 缺口清单 §4.10 #18：**强制 mock 前置护栏**——所有 E2E 都按 mock 后端编写，
 *    而 backend/data/llm-config.json（API 配置页保存，llm_mode=real）优先于
 *    LLM_MODE 环境变量（llm_runtime.py），会让"mock 后端"实际跑在 real 模式上
 *    （2026-09-13 真实 Key 消耗事故）。此处跑前断言生效配置与 /api/generate
 *    响应均为 mock，否则**中止整个运行**——宁可不跑，不烧 Key、不出假结果。
 */
import { execSync } from 'node:child_process'

const BACKEND = 'http://localhost:8000'

function fail(msg: string): never {
  throw new Error(
    `[globalSetup] E2E 前置检查未通过：${msg}\n` +
      '本轮已中止，未执行任何用例（防止真实 Key 消耗与假 mock 误判）。\n' +
      '处理：用本地 mock 后端启动——cd backend && LLM_MODE=mock .venv/Scripts/uvicorn.exe app.main:app --port 8000\n' +
      '若仍为 real：检查 backend/data/llm-config.json（其 llm_mode 优先于环境变量，移走该文件或改为 mock 后重启后端）。',
  )
}

async function assertMockBackend(): Promise<void> {
  let login: Response
  try {
    login = await fetch(`${BACKEND}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'demo', password: 'demo123' }),
    })
  } catch {
    fail('后端不可达（:8000）。先启动本地后端（mock 模式）。')
  }
  if (!login.ok) fail(`后端登录失败（HTTP ${login.status}）。`)
  const { token } = (await login.json()) as { token: string }

  // 第一道（零成本）：生效配置的模式——backend/data/llm-config.json 覆盖 LLM_MODE 环境变量
  const cfg = await fetch(`${BACKEND}/api/llm-config`, { headers: { Authorization: `Bearer ${token}` } })
  if (!cfg.ok) fail(`读取 /api/llm-config 失败（HTTP ${cfg.status}）。`)
  const cfgBody = (await cfg.json()) as { llm_mode?: string }
  if (cfgBody.llm_mode !== 'mock') {
    fail(`生效 LLM 模式为 "${cfgBody.llm_mode ?? 'unknown'}"，不是 mock。`)
  }

  // 第二道（用户指定口径）：/api/generate 响应 mock === true
  const gen = await fetch(`${BACKEND}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ prompt: '设计一个登录页' }),
  })
  if (!gen.ok) fail(`/api/generate 探针失败（HTTP ${gen.status}）。`)
  const genBody = (await gen.json()) as { mock?: boolean }
  if (genBody.mock !== true) {
    fail(`/api/generate 响应 mock !== true（实际 ${String(genBody.mock)}）——配置与实际行为不一致，禁止继续。`)
  }
  console.log('[globalSetup] mock 前置断言通过（llm_mode=mock 且 /api/generate mock=true）')
}

export default async function globalSetup() {
  const run = (cmd: string) => execSync(cmd, { stdio: 'pipe', timeout: 60_000 })
  try {
    run('docker stop design-y-websocket')
    // leveldb 持久化在 /data 根目录（非 /data/storage——旧路径从未生效，导致 room 残留）
    run('docker run --rm -v docker_yjsdata:/data node:22-alpine sh -c "rm -rf /data/*"')
    run('docker start design-y-websocket')
    console.log('[globalSetup] y-websocket 状态已清空并重启')
  } catch (err) {
    console.warn('[globalSetup] 无法重置 y-websocket：', (err as Error).message.split('\n')[0])
  }
  await assertMockBackend()
}
