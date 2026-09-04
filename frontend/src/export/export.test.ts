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
    expect(code).toContain('"background":"#F5F5F5"') // background 令牌解析（JSON 双引号对象字面量）
    expect(code).toContain('"padding":24') // R1：padding 键必须出现在产物（不再被 styleToCss 丢弃）
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
    expect(html).toContain('padding: 24px') // R1：HTML 通道同样输出 padding
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

describe('导出安全（P0-1）', () => {
  it('React 通道：style 值含引号不逃逸对象字面量（styleLiteral 输出合法 JSON）', () => {
    const evil: DesignNode = {
      id: 'r',
      type: 'frame',
      style: { color: `red'});globalThis.__pwned=1;//` },
      children: [],
    }
    const code = designToReactApp(evil, false)
    const styleLiterals = [...code.matchAll(/style=\{\{(\{.*?\})\}\}/gs)].map((m) => m[1])
    expect(styleLiterals.length).toBeGreaterThan(0)
    // 恶意 style 字面量必须能被 JSON.parse 完整解析（引号由 JSON 规则包裹，无法提前闭合执行）
    const evilObj = styleLiterals.find((s) => s.includes('__pwned'))
    expect(evilObj).toBeTruthy()
    expect(() => JSON.parse(evilObj!)).not.toThrow()
  })

  it('HTML 通道：style 字符串值实体化，防属性逃逸注入', () => {
    const evil: DesignNode = {
      id: 'r',
      type: 'frame',
      style: { color: 'red"; onmouseover="alert(1)' },
      children: [],
    }
    const html = designToHtml(evil)
    expect(html).not.toContain('onmouseover="')
    expect(html).toContain('&quot;')
  })

  it('javascript: href 在 React 与 HTML 双通道均降级为 #，合法 URL 保留', () => {
    const nav: DesignNode = {
      id: 'r',
      type: 'frame',
      children: [
        {
          id: 'n',
          type: 'component',
          componentType: 'navbar',
          props: { title: 'T', links: [{ label: 'bad', href: 'javascript:alert(1)' }, { label: 'ok', href: 'https://ok.com/a' }] },
        },
      ],
    }
    const code = designToReactApp(nav, false)
    expect(code).toContain('href="#"')
    expect(code).toContain('href="https://ok.com/a"')
    const html = designToHtml(nav)
    expect(html).toContain('href="#"')
    expect(html).toContain('href="https://ok.com/a"')
  })

  it('img src 协议白名单：javascript:/控制字符伪装被拦截为空，http/data:image 保留', () => {
    const imgs: DesignNode = {
      id: 'r',
      type: 'frame',
      children: [
        { id: 'a', type: 'component', componentType: 'image', props: { src: 'javascript:alert(1)', alt: 'bad' } },
        { id: 'b', type: 'component', componentType: 'image', props: { src: 'java\nscript:alert(1)', alt: 'spoof' } },
        { id: 'c', type: 'component', componentType: 'image', props: { src: 'https://cdn.x/img.png', alt: 'ok' } },
        { id: 'd', type: 'component', componentType: 'image', props: { src: 'data:image/png;base64,AAA', alt: 'data' } },
      ],
    }
    const code = designToReactApp(imgs, false)
    expect(code).toContain('src=""')
    expect(code).toContain('src="https://cdn.x/img.png"')
    expect(code).toContain('src="data:image/png;base64,AAA"')
    const html = designToHtml(imgs)
    expect(html).toContain('src=""')
    expect(html).toContain('src="https://cdn.x/img.png"')
    expect(html).toContain('src="data:image/png;base64,AAA"')
  })
})
