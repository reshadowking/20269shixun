import path from 'node:path'

import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    // 开发期代理 /api 到后端（v2.2 §13 本机开发）
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        // 前端路由 /api-config 以 /api 开头会被前缀匹配误代理到后端（返回 404 JSON）：
        // bypass 返回请求路径 = 不代理，交给 Vite SPA fallback 处理
        bypass(req) {
          if (req.url?.startsWith('/api-config')) return req.url
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'], // 排除 e2e/（Playwright spec）
    // T40 曾关掉**文件级并行**（并行时 freeze/geometryAudit/followup+theme 偶发红：多 worker 同时初始化
    // jsdom、争 CPU 时失稳）。T42 把根因补掉了——测量用例改离屏树、全局 afterEach 清 body 残留、
    // 几何体检只量本页画布；此后串行与满载都稳。
    // 2026-09-16 打开并行提速（102s → ~25s）。**若再出现偶发红**：先看是不是又引入了跨用例的
    // DOM/localStorage 依赖（那是要修的根因），确属资源竞争再把这行改回 false。
    fileParallelism: true,
    // T13-A4：覆盖率基线口径——含 src/**，排除工作台 UI 配方层（components/ui，shadcn 配方不外测）
    // 与测试自身；报告 text（终端）+ json-summary（供验收方机器读取）；产物 coverage/ 已在 .gitignore
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      exclude: ['src/components/ui/**', 'src/**/*.test.*'],
      reporter: ['text', 'json-summary'],
    },
  },
})
