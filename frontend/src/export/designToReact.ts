/**
 * DesignNode → 完整 React 页面代码（P0-2 一键转代码）。
 * - 复用 styleToCss（设计键名→React CSS）与 escapeHtml（XSS 转义）
 * - 组件按 componentType 映射到语义化原生标签（不依赖任何 UI 库，内联样式）
 * - 输出 App.tsx 可编译的 JSX 代码（无运行时数据依赖）
 */
import type { DesignNode } from '@/design/types'
import { escapeHtml, safeHref, safeSrc } from '@/design/escape'
import { styleToCss } from '@/design/styleToCss'

/** style 转 React 内联样式对象字面量。
 * 直接输出 JSON.stringify 结果：双引号 JSON 本身是合法 JS 对象字面量，
 * 键/值引号由 JSON 规则转义，避免手工引号替换把值里的 ' 变成裸字符串边界（注入面）。 */
function styleLiteral(style: DesignNode['style']): string {
  return JSON.stringify(styleToCss(style))
}

function componentTag(node: DesignNode): string {
  const props = node.props ?? {}
  const style = styleLiteral(node.style)
  const text = escapeHtml(typeof props.text === 'string' ? props.text : '')
  switch (node.componentType) {
    case 'button':
      return `<button data-component="button" style={{${style}}}>${text}</button>`
    case 'title-text': {
      const level = typeof props.level === 'number' && props.level >= 1 && props.level <= 6 ? props.level : 2
      return `<h${level} data-component="title-text" style={{${style}}}>${text}</h${level}>`
    }
    case 'input': {
      const label = typeof props.label === 'string' && props.label ? `<label style={{display:'block',fontSize:13,color:'#4E5969',marginBottom:6}}>${escapeHtml(props.label)}</label>` : ''
      return `<div data-component="input">${label}<input style={{${style}}} placeholder="${escapeHtml(typeof props.placeholder === 'string' ? props.placeholder : '')}" ${props.disabled ? 'disabled' : ''} /></div>`
    }
    case 'select': {
      const options = Array.isArray(props.options) ? props.options.map((o) => String(o)) : []
      return `<div data-component="select"><select style={{${style}}}>${options.map((o) => `\n        <option>${escapeHtml(o)}</option>`).join('')}\n      </select></div>`
    }
    case 'image':
      return `<img data-component="image" style={{${style}}} src="${escapeHtml(safeSrc(typeof props.src === 'string' ? props.src : ''))}" alt="${escapeHtml(typeof props.alt === 'string' ? props.alt : '图片')}" />`
    case 'avatar':
      return `<div data-component="avatar" style={{${style},borderRadius:'50%',display:'flex',alignItems:'center',justifyContent:'center'}}>${escapeHtml(typeof props.name === 'string' ? props.name.slice(0, 1) : '')}</div>`
    case 'tag':
      return `<span data-component="tag" style={{${style}}}>${text}</span>`
    case 'divider':
      return `<hr data-component="divider" style={{${style}}} />`
    case 'navbar': {
      const links = Array.isArray(props.links) ? props.links : []
      return `<nav data-component="navbar" style={{${style}}}>\n        <strong>${escapeHtml(typeof props.title === 'string' ? props.title : '')}</strong>\n        ${links
        .map((l) => `<a href="${escapeHtml(safeHref(typeof (l as Record<string, unknown>).href === 'string' ? ((l as Record<string, unknown>).href as string) : undefined))}">${escapeHtml(typeof (l as Record<string, unknown>).label === 'string' ? ((l as Record<string, unknown>).label as string) : '')}</a>`)
        .join('\n        ')}\n      </nav>`
    }
    case 'sidebar': {
      const items = Array.isArray(props.items) ? props.items : []
      return `<aside data-component="sidebar" style={{${style}}}>\n        ${items
        .map((it) => `<div style={{padding:'8px 12px'}}>${escapeHtml(typeof (it as Record<string, unknown>).label === 'string' ? ((it as Record<string, unknown>).label as string) : '')}</div>`)
        .join('\n        ')}\n      </aside>`
    }
    case 'hero':
      return `<section data-component="hero" style={{${style}}}>\n        <h2>${escapeHtml(typeof props.title === 'string' ? props.title : '')}</h2>\n        <p>${escapeHtml(typeof props.subtitle === 'string' ? props.subtitle : '')}</p>\n        ${props.cta && typeof (props.cta as Record<string, unknown>).text === 'string' ? `<button>${escapeHtml(((props.cta as Record<string, unknown>).text as string))}</button>` : ''}\n      </section>`
    case 'stat-block':
      return `<div data-component="stat-block" style={{${style}}}>\n        <div style={{fontSize:13,color:'#86909C'}}>${escapeHtml(typeof props.label === 'string' ? props.label : '')}</div>\n        <div style={{fontSize:24,fontWeight:700}}>${escapeHtml(typeof props.value === 'string' ? props.value : '')}</div>\n        ${props.trend ? `<div style={{fontSize:12,color:'#00A870'}}>${escapeHtml(String(props.trend))}</div>` : ''}\n      </div>`
    case 'table': {
      const columns = Array.isArray(props.columns) ? (props.columns as Array<Record<string, unknown>>) : []
      const rows = Array.isArray(props.rows) ? (props.rows as Array<Record<string, unknown>>) : []
      return `<table data-component="table" style={{${style},borderCollapse:'collapse',width:'100%'}}>\n        <thead><tr>${columns.map((c) => `<th style={{border:'1px solid #E5E8EF',padding:8}}>${escapeHtml(typeof c.title === 'string' ? c.title : '')}</th>`).join('')}</tr></thead>\n        <tbody>${rows.map((r) => `<tr>${columns.map((c) => `<td style={{border:'1px solid #E5E8EF',padding:8}}>${escapeHtml(typeof r[String(c.key)] === 'string' ? String(r[String(c.key)]) : '')}</td>`).join('')}</tr>`).join('')}</tbody>\n      </table>`
    }
    case 'chart': {
      const data = Array.isArray(props.data) ? (props.data as Array<Record<string, unknown>>) : []
      const xKey = typeof props.xKey === 'string' ? props.xKey : 'name'
      const yKey = typeof props.yKey === 'string' ? props.yKey : 'value'
      const max = Math.max(1, ...data.map((d) => Number(d[yKey]) || 0))
      return `<div data-component="chart" style={{${style}}}>\n        <div style={{fontSize:14,fontWeight:600,marginBottom:12}}>${escapeHtml(typeof props.title === 'string' ? props.title : '')}</div>\n        <div style={{display:'flex',alignItems:'flex-end',gap:12,height:160}}>\n          ${data.map((d) => `<div style={{flex:1,background:'#3D7FFF',borderRadius:'4px 4px 0 0',height:${Math.round(((Number(d[yKey]) || 0) / max) * 140)}px}} title="${escapeHtml(String(d[xKey]))}: ${escapeHtml(String(d[yKey]))}" />`).join('')}\n        </div>\n        <div style={{display:'flex',gap:12,marginTop:8}}>${data.map((d) => `<span style={{flex:1,textAlign:'center',fontSize:11,color:'#86909C'}}>${escapeHtml(String(d[xKey]))}</span>`).join('')}</div>\n      </div>`
    }
    default:
      // card / 未识别组件 → 通用容器
      return `<div data-component="${node.componentType ?? 'card'}" style={{${style}}}>\n        ${text ? `<p>${text}</p>` : ''}${props.title ? `<h3>${escapeHtml(String(props.title))}</h3>` : ''}${props.content ? `<p>${escapeHtml(String(props.content))}</p>` : ''}\n      </div>`
  }
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
