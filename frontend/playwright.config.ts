import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  retries: 0,
  // 清空 y-websocket room 残留状态（测试可复现）
  globalSetup: './e2e-global-setup.ts',
  // 每个测试文件独立串行跑（协作测试共享 y-websocket room，避免并发文档竞争）
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: 'http://localhost:5173',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
})
