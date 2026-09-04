/**
 * DesignNode → 完整 React 页面代码（P0-2 一键转代码）。
 * - 复用 styleToCss（设计键名→React CSS）与 escapeHtml（XSS 转义）
 * - 组件按 componentType 映射到语义化原生标签（不依赖任何 UI 库，内联样式）
 * - 输出 App.tsx 可编译的 JSX 代码（无运行时数据依赖）
 */
import { componentRegistry } from '@/components/canvas/registry'
import type { ExportElement } from '@/components/canvas/types'
import type { DesignNode } from '@/design/types'
import { escapeHtml } from '@/design/escape'
import { styleToCss } from '@/design/styleToCss'

/** style 转 React 内联样式对象字面量。
 * 直接输出 JSON.stringify 结果：双引号 JSON 本身是合法 JS 对象字面量，
 * 键/值引号由 JSON 规则转义，避免手工引号替换把值里的 ' 变成裸字符串边界（注入面）。 */
function styleLiteral(style: DesignNode['style']): string {
  return JSON.stringify(styleToCss(style))
}

const VOID_TAGS = new Set(['img', 'input', 'hr', 'br'])

/** B1：React 序列化 ExportElement——根元素（componentType 有值）带 data-component；子元素递归不带 */
function serializeReactElement(el: ExportElement, componentType?: string): string {
  const dc = componentType ? ` data-component="${componentType}"` : ''
  const styleStr = Object.keys(el.style).length > 0 ? ` style={{${JSON.stringify(el.style)}}}` : ''
  const attrsStr = Object.entries(el.attrs)
    .map(([k, v]) => ` ${k}="${escapeHtml(v)}"`)
    .join('')
  const inner = el.children
    ? el.children.map((c) => serializeReactElement(c)).join('')
    : el.text !== undefined
      ? escapeHtml(el.text)
      : ''
  const open = `<${el.tag}${dc}${styleStr}${attrsStr}`
  if (VOID_TAGS.has(el.tag)) return `${open} />`
  return `${open}>${inner}</${el.tag}>`
}

function componentTag(node: DesignNode): string {
  // B1 试点：组件注册了 buildExport 时走语义节点序列化（button/image）；其余仍在下方 switch
  const def = componentRegistry[node.componentType ?? '']
  if (def?.buildExport) return serializeReactElement(def.buildExport(node), node.componentType!)
  const props = node.props ?? {}
  const style = styleLiteral(node.style)
  const text = escapeHtml(typeof props.text === 'string' ? props.text : '')
  // B1-2 全量迁移：所有组件经 registry.buildExport 序列化，此处仅为未注册组件兜底（契约测试保证不会发生）
  const ctitle = typeof props.title === 'string' ? props.title : ''
  const ccontent = typeof props.content === 'string' ? props.content : ''
  const ctext = text ? `<p>${text}</p>` : ''
  const inner = `${ctext}${ctitle ? `<h3>${escapeHtml(ctitle)}</h3>` : ''}${ccontent ? `<p>${escapeHtml(ccontent)}</p>` : ''}`
  return `<div data-component="${node.componentType ?? 'card'}" style={{${style}}}>${inner}</div>`
}

/** 递归生成节点 JSX（frame/text/component） */
function nodeToJsx(node: DesignNode, depth: number): string {
  const pad = '  '.repeat(depth)
  const style = styleLiteral(node.style)

  if (node.type === 'text') {
    const text = escapeHtml(typeof node.props?.text === 'string' ? node.props.text : '')
    return `${pad}<div style={{${style}}}>${text}</div>`
  }
  if (node.type === 'component') {
    const tag = componentTag(node)
    return tag
      .split('\n')
      .map((line, i) => (i === 0 ? `${pad}${line}` : line))
      .join('\n')
  }
  // frame / group / rect
  const children = (node.children ?? []).filter((c) => !c.hidden).map((c) => nodeToJsx(c, depth + 1)).join('\n')
  if (!children) return `${pad}<div style={{${style}}}></div>`
  return `${pad}<div style={{${style}}}>\n${children}\n${pad}</div>`
}

/** DesignNode → App.tsx 文件内容 */
export function designToReactApp(design: DesignNode, withComments: boolean): string {
  const body = nodeToJsx(design, 2)
  const comment = withComments
    ? `  {/* 由 AI 原生设计工作台 v0.2 导出的 React 页面（内联样式，无 UI 库依赖） */}\n`
    : ''
  return `export default function App() {
${comment}  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: 24, background: '#EEF0F4', minHeight: '100vh' }}>
${body}
    </div>
  )
}
`
}
