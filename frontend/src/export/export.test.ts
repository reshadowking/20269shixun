/**
 * 导出生成器测试（P0-2）：designToReactApp / designToHtml / buildEngineFiles。
 */
import { describe, expect, it } from 'vitest'

import type { DesignNode } from '@/design/types'
import { designToHtml } from './designToHtml'
import { designToReactApp } from './designToReact'
import { buildEngineFiles } from './engineTemplate'

const DESIGN: DesignNode = {
  id: 'root',
  type: 'frame',
  style: { layout: 'column', gap: 16, background: 'background', padding: 24, width: 480 },
  children: [
    { id: 't1', type: 'text', props: { text: '商品标题' }, style: { color: 'text-primary', fontSize: 20, fontWeight: 600 } },
    { id: 'b1', type: 'component', componentType: 'button', props: { text: '立即购买' }, style: { width: 160, height: 44, background: 'primary', color: '#FFFFFF', radius: 8 } },
  ],
}

describe('designToReactApp', () => {
  it('生成包含组件与文本的 JSX', () => {
    const code = designToReactApp(DESIGN, true)
    expect(code).toContain('export default function App()')
    expect(code).toContain('<button')
    expect(code).toContain('立即购买')
    expect(code).toContain('商品标题')
    expect(code).toContain("background:'#F5F5F5'") // background 令牌解析
  })

  it('文本做 XSS 转义', () => {
    const evil: DesignNode = {
      id: 'r',
      type: 'frame',
      children: [{ id: 'x', type: 'text', props: { text: '<script>alert(1)</script>' } }],
    }
    const code = designToReactApp(evil, false)
    expect(code).not.toContain('<script>')
    expect(code).toContain('&lt;script&gt;')
  })

  it('组件 props 文本转义', () => {
    const evil: DesignNode = {
      id: 'r',
      type: 'frame',
      children: [{ id: 'b', type: 'component', componentType: 'button', props: { text: '<img src=x onerror=alert(1)>' } }],
    }
    const code = designToReactApp(evil, false)
    // 危险标签被转义为纯文本（< 与 > 转义后浏览器不会解析执行）
    expect(code).not.toContain('<img src=x')
    expect(code).toContain('&lt;img src=x onerror=alert(1)&gt;')
  })

  it('注释选项控制', () => {
    expect(designToReactApp(DESIGN, true)).toContain('{/*')
    expect(designToReactApp(DESIGN, false)).not.toContain('{/*')
  })

  it('hidden 节点不导出', () => {
    const hidden: DesignNode = {
      id: 'r',
      type: 'frame',
      children: [
        { id: 'a', type: 'text', props: { text: '可见' } },
        { id: 'b', type: 'text', props: { text: '隐藏内容' }, hidden: true },
      ],
    }
    const code = designToReactApp(hidden, false)
    expect(code).toContain('可见')
    expect(code).not.toContain('隐藏内容')
  })
})

describe('designToHtml', () => {
  it('生成完整 HTML 文档', () => {
    const html = designToHtml(DESIGN)
    expect(html).toContain('<!doctype html>')
    expect(html).toContain('<button')
    expect(html).toContain('商品标题')
  })

  it('HTML 文本转义', () => {
    const evil: DesignNode = { id: 'r', type: 'frame', children: [{ id: 'x', type: 'text', props: { text: '<script>alert(1)</script>' } }] }
    const html = designToHtml(evil)
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })
})

describe('buildEngineFiles', () => {
  it('关键文件齐全且可解析', () => {
    const files = buildEngineFiles('export default function App() {}', true)
    expect(files['package.json']).toBeTruthy()
    expect(files['index.html']).toContain('root')
    expect(files['src/main.tsx']).toContain('createRoot')
    expect(files['src/App.tsx']).toContain('App')
    expect(files['vite.config.ts']).toContain('react')
    expect(files['tsconfig.json']).toContain('jsx')
    const pkg = JSON.parse(files['package.json'])
    expect(pkg.scripts.dev).toBe('vite')
    expect(pkg.dependencies.react).toBeTruthy()
  })
})
