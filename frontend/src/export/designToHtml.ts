/**
 * DesignNode → 静态 HTML 预览（P0-2 导出对话框 iframe srcdoc 用）。
 * 与 designToReact 同构但输出纯 HTML+CSS（无 React 运行时）。
 * B1 试点：注册了 buildExport 的组件（button/image）经 ExportElement 序列化。
 */
import type { DesignNode } from '@/design/types'
import { componentRegistry } from '@/components/canvas/registry'
import type { AssetMap } from '@/export/inlineAssets'
import type { ExportElement } from '@/components/canvas/types'
import { escapeHtml } from '@/design/escape'
import { styleToCss } from '@/design/styleToCss'

function cssText(style: DesignNode['style']): string {
  return cssTextOfCss(styleToCss(style) as Record<string, unknown>)
}

/** 无单位数值属性（缺口清单 §4.7）：加 px 会被浏览器整条丢弃（opacity: 0.5px 等） */
const UNITLESS_PROPS = new Set([
  'opacity', 'fontWeight', 'flex', 'flexGrow', 'flexShrink', 'zIndex', 'order', 'lineHeight', 'aspectRatio',
])

/** CSSProperties → "kebab: value; …"（字符串值实体化防属性注入；number → px，无单位白名单除外） */
function cssTextOfCss(css: Record<string, unknown>): string {
  const parts: string[] = []
  for (const [key, value] of Object.entries(css)) {
    if (value === undefined || value === null) continue
    const kebab = key.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)
    // 字符串值过 escapeHtml：防 style="..." 属性逃逸（值含引号可闭合属性注入新属性）
    const v = typeof value === 'number' && !UNITLESS_PROPS.has(key) ? `${value}px` : escapeHtml(String(value))
    parts.push(`${kebab}: ${v}`)
  }
  return parts.join('; ')
}

const VOID_TAGS = new Set(['img', 'input', 'hr', 'br'])

/** 属性值解析：src 命中内联映射时替换为 dataURL（ADR-008 图片导出内联） */
function resolveAttr(name: string, value: string, assets?: AssetMap): string {
  if (name === 'src' && assets && assets[value]) return assets[value]
  return value
}

/** B1：HTML 序列化 ExportElement——style 空时省略属性；attrs 统一转义；children 递归 */
function serializeHtmlElement(el: ExportElement, assets?: AssetMap): string {
  const styleAttr = Object.keys(el.style).length > 0 ? ` style="${cssTextOfCss(el.style as Record<string, unknown>)}"` : ''
  const attrsStr = Object.entries(el.attrs)
    .map(([k, v]) => ` ${k}="${escapeHtml(resolveAttr(k, v, assets))}"`)
    .join('')
  const inner = el.children
    ? el.children.map((c) => serializeHtmlElement(c, assets)).join('')
    : el.text !== undefined
      ? escapeHtml(el.text)
      : ''
  const open = `<${el.tag}${styleAttr}${attrsStr}`
  if (VOID_TAGS.has(el.tag)) return `${open} />`
  return `${open}>${inner}</${el.tag}>`
}

function componentHtml(node: DesignNode, assets?: AssetMap): string {
  // B1 试点：注册了 buildExport 的组件经语义节点序列化（button/image）；其余仍在下方 switch
  const def = componentRegistry[node.componentType ?? '']
  if (def?.buildExport) return serializeHtmlElement(def.buildExport(node), assets)
  const props = node.props ?? {}
  const style = cssText(node.style)
  const text = escapeHtml(typeof props.text === 'string' ? props.text : '')
  // B1-2 全量迁移：所有组件经 registry.buildExport 序列化，此处仅为未注册组件兜底（契约测试保证不会发生）
  const ctitle = typeof props.title === 'string' ? props.title : ''
  const ccontent = typeof props.content === 'string' ? props.content : ''
  const inner = `${ctitle ? `<h3>${escapeHtml(ctitle)}</h3>` : ''}${ccontent ? `<p>${escapeHtml(ccontent)}</p>` : ''}${text ? `<p>${text}</p>` : ''}`
  return `<div style="${style}">${inner}</div>`
}

function nodeHtml(node: DesignNode, assets?: AssetMap): string {
  if (node.type === 'text') {
    return `<div style="${cssText(node.style)}">${escapeHtml(typeof node.props?.text === 'string' ? node.props.text : '')}</div>`
  }
  if (node.type === 'component') return componentHtml(node, assets)
  const children = (node.children ?? []).filter((c) => !c.hidden).map((c) => nodeHtml(c, assets)).join('')
  return `<div style="${cssText(node.style)}">${children}</div>`
}

/**
 * DesignNode → 完整 HTML 文档（iframe srcdoc 预览 / ZIP 内 preview.html）。
 *
 * @param assets 可选：图片内联映射（见 ADR-008）；不传时行为与改造前一致。
 */
export function designToHtml(design: DesignNode, assets?: AssetMap): string {
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
${nodeHtml(design, assets).split('\n').map((l) => `    ${l}`).join('\n')}
  </div>
</body>
</html>`
}
