/**
 * DesignNode → 静态 HTML 预览（P0-2 导出对话框 iframe srcdoc 用）。
 * 与 designToReact 同构但输出纯 HTML+CSS（无 React 运行时）。
 * B1 试点：注册了 buildExport 的组件（button/image）经 ExportElement 序列化。
 */
import type { DesignNode } from '@/design/types'
import { componentRegistry } from '@/components/canvas/registry'
import type { ExportElement } from '@/components/canvas/types'
import { escapeHtml, safeHref } from '@/design/escape'
import { styleToCss } from '@/design/styleToCss'

function cssText(style: DesignNode['style']): string {
  return cssTextOfCss(styleToCss(style) as Record<string, unknown>)
}

/** CSSProperties → "kebab: value; …"（字符串值实体化防属性注入；number → px） */
function cssTextOfCss(css: Record<string, unknown>): string {
  const parts: string[] = []
  for (const [key, value] of Object.entries(css)) {
    if (value === undefined || value === null) continue
    const kebab = key.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)
    // 字符串值过 escapeHtml：防 style="..." 属性逃逸（值含引号可闭合属性注入新属性）
    const v = typeof value === 'number' ? `${value}px` : escapeHtml(String(value))
    parts.push(`${kebab}: ${v}`)
  }
  return parts.join('; ')
}

const VOID_TAGS = new Set(['img', 'input', 'hr', 'br'])

/** B1：HTML 序列化 ExportElement——style 空时省略属性；attrs 统一转义 */
function serializeHtmlElement(el: ExportElement): string {
  const styleAttr = Object.keys(el.style).length > 0 ? ` style="${cssTextOfCss(el.style as Record<string, unknown>)}"` : ''
  const attrsStr = Object.entries(el.attrs)
    .map(([k, v]) => ` ${k}="${escapeHtml(v)}"`)
    .join('')
  const text = el.text !== undefined ? escapeHtml(el.text) : ''
  const open = `<${el.tag}${styleAttr}${attrsStr}`
  if (VOID_TAGS.has(el.tag)) return `${open} />`
  return `${open}>${text}</${el.tag}>`
}

function componentHtml(node: DesignNode): string {
  // B1 试点：注册了 buildExport 的组件经语义节点序列化（button/image）；其余仍在下方 switch
  const def = componentRegistry[node.componentType ?? '']
  if (def?.buildExport) return serializeHtmlElement(def.buildExport(node))
  const props = node.props ?? {}
  const style = cssText(node.style)
  const text = escapeHtml(typeof props.text === 'string' ? props.text : '')
  switch (node.componentType) {
    case 'title-text': {
      const level = typeof props.level === 'number' && props.level >= 1 && props.level <= 6 ? props.level : 2
      return `<h${level} style="${style}">${text}</h${level}>`
    }
    case 'input':
      return `<input style="${style}" placeholder="${escapeHtml(typeof props.placeholder === 'string' ? props.placeholder : '')}" />`
    case 'select': {
      const options = Array.isArray(props.options) ? props.options.map((o) => String(o)) : []
      return `<select style="${style}">${options.map((o) => `<option>${escapeHtml(o)}</option>`).join('')}</select>`
    }
    case 'avatar':
      return `<div style="${style}; border-radius: 50%; display: flex; align-items: center; justify-content: center;">${escapeHtml(typeof props.name === 'string' ? props.name.slice(0, 1) : '')}</div>`
    case 'tag':
      return `<span style="${style}">${text}</span>`
    case 'divider':
      return `<hr style="${style}" />`
    case 'navbar': {
      const links = Array.isArray(props.links) ? props.links : []
      return `<nav style="${style}"><strong>${escapeHtml(typeof props.title === 'string' ? props.title : '')}</strong> ${links
        .map((l) => `<a href="${escapeHtml(safeHref(typeof (l as Record<string, unknown>).href === 'string' ? ((l as Record<string, unknown>).href as string) : undefined))}" style="margin-left: 12px;">${escapeHtml(typeof (l as Record<string, unknown>).label === 'string' ? ((l as Record<string, unknown>).label as string) : '')}</a>`)
        .join('')}</nav>`
    }
    case 'sidebar': {
      const items = Array.isArray(props.items) ? props.items : []
      return `<aside style="${style}">${items.map((it) => `<div style="padding: 8px 12px;">${escapeHtml(typeof (it as Record<string, unknown>).label === 'string' ? ((it as Record<string, unknown>).label as string) : '')}</div>`).join('')}</aside>`
    }
    case 'hero':
      return `<section style="${style}"><h2>${escapeHtml(typeof props.title === 'string' ? props.title : '')}</h2><p>${escapeHtml(typeof props.subtitle === 'string' ? props.subtitle : '')}</p>${props.cta && typeof (props.cta as Record<string, unknown>).text === 'string' ? `<button>${escapeHtml(((props.cta as Record<string, unknown>).text as string))}</button>` : ''}</section>`
    case 'stat-block':
      return `<div style="${style}"><div style="font-size: 13px; color: #86909C;">${escapeHtml(typeof props.label === 'string' ? props.label : '')}</div><div style="font-size: 24px; font-weight: 700;">${escapeHtml(typeof props.value === 'string' ? props.value : '')}</div>${props.trend ? `<div style="font-size: 12px; color: #00A870;">${escapeHtml(String(props.trend))}</div>` : ''}</div>`
    case 'table': {
      const columns = Array.isArray(props.columns) ? (props.columns as Array<Record<string, unknown>>) : []
      const rows = Array.isArray(props.rows) ? (props.rows as Array<Record<string, unknown>>) : []
      return `<table style="${style}; border-collapse: collapse; width: 100%;"><thead><tr>${columns.map((c) => `<th style="border: 1px solid #E5E8EF; padding: 8px;">${escapeHtml(typeof c.title === 'string' ? c.title : '')}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${columns.map((c) => `<td style="border: 1px solid #E5E8EF; padding: 8px;">${escapeHtml(typeof r[String(c.key)] === 'string' ? String(r[String(c.key)]) : '')}</td>`).join('')}</tr>`).join('')}</tbody></table>`
    }
    case 'chart': {
      const data = Array.isArray(props.data) ? (props.data as Array<Record<string, unknown>>) : []
      const xKey = typeof props.xKey === 'string' ? props.xKey : 'name'
      const yKey = typeof props.yKey === 'string' ? props.yKey : 'value'
      const max = Math.max(1, ...data.map((d) => Number(d[yKey]) || 0))
      return `<div style="${style}"><div style="font-size: 14px; font-weight: 600; margin-bottom: 12px;">${escapeHtml(typeof props.title === 'string' ? props.title : '')}</div><div style="display: flex; align-items: flex-end; gap: 12px; height: 160px;">${data.map((d) => `<div style="flex: 1; background: #3D7FFF; border-radius: 4px 4px 0 0; height: ${Math.round(((Number(d[yKey]) || 0) / max) * 140)}px;" title="${escapeHtml(String(d[xKey]))}: ${escapeHtml(String(d[yKey]))}"></div>`).join('')}</div><div style="display: flex; gap: 12px; margin-top: 8px;">${data.map((d) => `<span style="flex: 1; text-align: center; font-size: 11px; color: #86909C;">${escapeHtml(String(d[xKey]))}</span>`).join('')}</div></div>`
    }
    default:
      return `<div style="${style}">${props.title ? `<h3>${escapeHtml(String(props.title))}</h3>` : ''}${props.content ? `<p>${escapeHtml(String(props.content))}</p>` : ''}${text ? `<p>${text}</p>` : ''}</div>`
  }
}

function nodeHtml(node: DesignNode): string {
  if (node.type === 'text') {
    return `<div style="${cssText(node.style)}">${escapeHtml(typeof node.props?.text === 'string' ? node.props.text : '')}</div>`
  }
  if (node.type === 'component') return componentHtml(node)
  const children = (node.children ?? []).filter((c) => !c.hidden).map(nodeHtml).join('')
  return `<div style="${cssText(node.style)}">${children}</div>`
}

/** DesignNode → 完整 HTML 文档（iframe srcdoc 预览） */
export function designToHtml(design: DesignNode): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<title>设计稿预览</title>
<style>
  body { margin: 0; background: #EEF0F4; font-family: Inter, "Microsoft YaHei", sans-serif; }
  img { max-width: 100%; object-fit: cover; }
</style>
</head>
<body>
  <div style="display: flex; justify-content: center; padding: 24px; min-height: 100vh; background: #EEF0F4;">
${nodeHtml(design).split('\n').map((l) => `    ${l}`).join('\n')}
  </div>
</body>
</html>`
}
