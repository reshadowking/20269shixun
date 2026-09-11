/**
 * 完整 Vite + React + TS 工程模板（P0-2）：导出 ZIP 的内容。
 * 生成的文件经 `npm install && npm run dev` 可直接运行（内联样式，零额外依赖）。
 */
export interface EngineFiles {
  [path: string]: string
}

export const PROJECT_NAME = 'ai-design-export'

function packageJson(): string {
  return JSON.stringify(
    {
      name: PROJECT_NAME,
      private: true,
      version: '0.1.0',
      type: 'module',
      scripts: {
        dev: 'vite',
        build: 'tsc -b && vite build',
        preview: 'vite preview',
      },
      dependencies: {
        react: '^19.0.0',
        'react-dom': '^19.0.0',
      },
      devDependencies: {
        '@types/react': '^19.0.0',
        '@types/react-dom': '^19.0.0',
        '@vitejs/plugin-react': '^4.3.0',
        typescript: '~5.6.0',
        vite: '^6.0.0',
      },
    },
    null,
    2,
  )
}

/**
 * 生成完整可运行工程的全部文件（App.tsx 由 designToReactApp 产出）。
 *
 * @param previewHtml 可选：自包含单文件预览页（designToHtml 产物）。
 *   传入则写入 `preview.html` —— 双击即开、无需联网与安装依赖，
 *   对应需求「可直接运行并查看浏览器预览效果」。不传则不产出该文件（向后兼容）。
 */
export function buildEngineFiles(appCode: string, withComments: boolean, previewHtml?: string): EngineFiles {
  const readme = `# ${PROJECT_NAME}

由「AI 原生设计工作台 v0.2」导出的 React 页面工程。

## 两种查看方式

- **快速查看效果**：直接双击 \`preview.html\`（单文件、无需联网、无需安装依赖）
- **接入开发**：\`npm install && npm run dev\`，业务代码在 \`src/App.tsx\`

## 运行

\`\`\`bash
npm install
npm run dev
\`\`\`

浏览器打开 http://localhost:5173 查看。${withComments ? '\n\n导出时包含注释。' : ''}
`
  const files: EngineFiles = {
    'package.json': packageJson(),
    'vite.config.ts': `import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
})
`,
    'tsconfig.json': `{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "isolatedModules": true,
    "moduleDetection": "force",
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true
  },
  "include": ["src"]
}
`,
    'index.html': `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>AI 设计导出</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`,
    'src/main.tsx': `import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
`,
    'src/App.tsx': appCode,
    'README.md': readme,
  }
  if (previewHtml) files['preview.html'] = previewHtml
  return files
}
