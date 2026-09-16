/**
 * 导出产物的**语法守门**（2026-09-16 补）。
 *
 * 起因：验收方把真实导出的 React 文件喂给 tsc，报出十几条语法错——根因是
 * `style={{${JSON.stringify(x)}}}` 多了一层花括号（`JSON.stringify` 自带 `{}`），
 * 产物变成 `style={{{…}}}`。而当时的 `parity.test.ts` **全是子串断言**，
 * 从不把产物交给解析器，所以功能测试全绿、产物却编译不过。
 *
 * 这里用仓库自带的 typescript 解析器（不新增依赖、不做类型检查，只看语法）：
 * **产物只要有语法错就红**。同类问题以后一次性挡住。
 */
import { describe, expect, it } from 'vitest'
import ts from 'typescript'

import type { DesignNode } from '@/design/types'

import { designToReactApp } from './designToReact'

/** 用 TS 解析器检查语法（TSX！否则 `<div>` 会被当成类型断言） */
function syntaxErrors(code: string): string[] {
  const source = ts.createSourceFile('App.tsx', code, ts.ScriptTarget.Latest, false, ts.ScriptKind.TSX)
  // `parseDiagnostics` 是 TS 的内部字段（公开类型里没有，运行时确实存在）——这里显式取一次
  const diagnostics = (source as unknown as { parseDiagnostics?: Array<{ messageText: unknown }> }).parseDiagnostics ?? []
  return diagnostics.map((d) => ts.flattenDiagnosticMessageText(d.messageText as never, ' / '))
}

/** 覆盖面尽量广：文本 / 注册组件 / 未注册组件兜底 / 空容器 / 有样式与无样式 / 图片内联 */
function richDesign(): DesignNode {
  return {
    id: 'root',
    type: 'frame',
    style: { layout: 'column', width: 800, height: 600, padding: 24, background: 'background' },
    children: [
      { id: 't1', type: 'text', props: { text: '标题' }, style: { fontSize: 20, color: 'text' } },
      { id: 't2', type: 'text', props: { text: '无样式的文本' } },
      { id: 'b1', type: 'component', componentType: 'button', props: { text: '提交' }, style: { background: 'primary' } },
      { id: 'i1', type: 'component', componentType: 'image', props: { src: '/api/images/1', alt: '配图' }, style: {} },
      { id: 'c1', type: 'component', componentType: 'card', props: { title: '卡片', content: '内容' }, style: { background: 'card' } },
      // 未注册组件：走 componentTag 的兜底分支（那条模板曾经也是三层花括号）
      { id: 'x1', type: 'component', componentType: 'not-registered-xyz' as never, props: { text: '兜底' }, style: { color: 'text' } },
      { id: 'empty', type: 'frame', style: { width: 100 }, children: [] },
      {
        id: 'nested',
        type: 'frame',
        style: { layout: 'row', gap: 8 },
        children: [{ id: 'n1', type: 'text', props: { text: '嵌套' }, style: { fontWeight: 600 } }],
      },
    ],
  }
}

describe('导出产物语法守门（designToReact）', () => {
  it('富设计稿（含注释）零语法错', () => {
    const code = designToReactApp(richDesign(), true)
    expect(syntaxErrors(code)).toEqual([])
  })

  it('不带注释时同样零语法错', () => {
    const code = designToReactApp(richDesign(), false)
    expect(syntaxErrors(code)).toEqual([])
  })

  it('图片内联（assets 映射）后仍然零语法错', () => {
    const code = designToReactApp(richDesign(), true, { '/api/images/1': 'data:image/png;base64,iVBORw0KGgo=' })
    expect(syntaxErrors(code)).toEqual([])
    expect(code).toContain('data:image/png;base64,')
  })

  it('回归断言：产物里不得出现三层花括号（P0 根因）', () => {
    const code = designToReactApp(richDesign(), true)
    expect(code).not.toContain('style={{{')
    // 而且出现的 style 表达式必须是「= { 一个 JSON 对象 }」的形态
    for (const match of code.matchAll(/style=\{([^}]*)\}/g)) {
      expect(match[1].trim().startsWith('"') || match[1].trim().startsWith('{')).toBe(true)
    }
  })

  it('空设计稿也零语法错（没有任何子节点）', () => {
    const bare: DesignNode = { id: 'root', type: 'frame', style: {} }
    expect(syntaxErrors(designToReactApp(bare, true))).toEqual([])
  })
})
