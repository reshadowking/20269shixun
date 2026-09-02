import type { CSSProperties } from 'react'

import { componentRegistry } from '@/components/canvas/registry'
import { styleToCss } from '@/design/styleToCss'
import type { DesignNode } from '@/design/types'

/**
 * DesignNode → DOM 渲染（v2.2 §3.2：设计 JSON 是唯一数据源，渲染层是它的投影）。
 * frame/group → flex div；text → 文本；rect → 色块；component → 注册表真实组件。
 * 组件缺失时渲染虚线占位块并标记警告（v2.2 §3.1 铁律）。
 * 样式转换统一走 styleToCss（radius→borderRadius 等），保证组件内外层一致。
 */

/** 注册表组件渲染；未注册组件 → 虚线占位 + 警告（v2.2 §3.1） */
function RegistryComponent({ node, onComponentPropsChange }: { node: DesignNode; onComponentPropsChange?: (id: string, key: string, value: unknown) => void }) {
  const type = node.componentType ?? 'unknown'
  const def = componentRegistry[type]
  if (!def) {
    return (
      <div
        className="flex h-full w-full flex-col items-center justify-center gap-1 rounded-md border-2 border-dashed border-destructive/50 bg-destructive/5 text-xs text-destructive"
        data-warning="unregistered-component"
      >
        <span>⚠ {type}</span>
        <span className="text-muted-foreground">组件未注册</span>
      </div>
    )
  }
  const Comp = def.Canvas
  // 传给组件的 style 是已转换的 CSS 样式（radius→borderRadius），组件内部直接透传即可生效
  return (
    <Comp
      props={node.props ?? {}}
      style={styleToCss(node.style)}
      onPropsChange={(key, value) => onComponentPropsChange?.(node.id, key, value)}
    />
  )
}

/** 选中节点的 8 方向缩放手柄（v2.2 §3.5 编辑能力扩展：自由调整大小） */
function ResizeHandles({ onResizeStart }: { onResizeStart: (e: React.PointerEvent, dir: string) => void }) {
  const HANDLES: Array<{ dir: string; style: React.CSSProperties }> = [
    { dir: 'nw', style: { left: -5, top: -5, cursor: 'nwse-resize' } },
    { dir: 'n', style: { left: '50%', top: -5, marginLeft: -4, cursor: 'ns-resize' } },
    { dir: 'ne', style: { right: -5, top: -5, cursor: 'nesw-resize' } },
    { dir: 'e', style: { right: -5, top: '50%', marginTop: -4, cursor: 'ew-resize' } },
    { dir: 'se', style: { right: -5, bottom: -5, cursor: 'nwse-resize' } },
    { dir: 's', style: { left: '50%', bottom: -5, marginLeft: -4, cursor: 'ns-resize' } },
    { dir: 'sw', style: { left: -5, bottom: -5, cursor: 'nesw-resize' } },
    { dir: 'w', style: { left: -5, top: '50%', marginTop: -4, cursor: 'ew-resize' } },
  ]
  return (
    <>
      {HANDLES.map((h) => (
        <div
          key={h.dir}
          data-resize-handle={h.dir}
          className="rounded-[2px]"
          style={{
            position: 'absolute',
            width: 8,
            height: 8,
            background: '#FFFFFF',
            border: '1.5px solid #0052D9',
            zIndex: 100,
            ...h.style,
          }}
          onPointerDown={(e) => {
            e.stopPropagation()
            onResizeStart(e, h.dir)
          }}
        />
      ))}
    </>
  )
}

interface NodeRendererProps {
  node: DesignNode
  selectedIds: Set<string>
  /** P0-1 增量编辑：被修改节点高亮闪烁 */
  highlightIds?: Set<string>
  /** 缺陷 4/14：组件内部交互写回 props */
  onComponentPropsChange?: (id: string, key: string, value: unknown) => void
  onDragStart: (e: React.PointerEvent, id: string) => void
  /** 父容器是 free 布局时，子节点以绝对定位渲染（v2.2 §3.2） */
  isFreeChild?: boolean
  /** 选中节点开始缩放（free 子节点显示 8 向手柄） */
  onResizeStart?: (e: React.PointerEvent, id: string, dir: string) => void
}

export function NodeRenderer({ node, selectedIds, highlightIds, onDragStart, isFreeChild = false, onResizeStart, onComponentPropsChange }: NodeRendererProps) {
  const style = node.style ?? {}
  const isSelected = selectedIds.has(node.id)
  const isHighlighted = Boolean(highlightIds?.has(node.id))

  const common: CSSProperties = {
    position: isFreeChild ? 'absolute' : undefined,
    left: isFreeChild && node.x !== undefined ? node.x : undefined,
    top: isFreeChild && node.y !== undefined ? node.y : undefined,
    outline: isHighlighted ? '2px solid #F59E0B' : isSelected ? '2px solid rgba(0, 82, 217, 0.65)' : undefined,
    outlineOffset: isSelected || isHighlighted ? 2 : undefined,
    animation: isHighlighted ? 'highlight-pulse 0.55s ease-in-out 3' : undefined,
    cursor: 'pointer',
    boxSizing: 'border-box',
    minWidth: node.type === 'text' ? undefined : 8,
    minHeight: node.type === 'text' ? undefined : 8,
  }

  const renderChildren = () =>
    node.children
      ?.filter((child) => !child.hidden) // 图层管理：隐藏节点不渲染（数据保留）
      .map((child) => (
        <NodeRenderer
          key={child.id}
          node={child}
          selectedIds={selectedIds}
          highlightIds={highlightIds}
          onDragStart={onDragStart}
          onComponentPropsChange={onComponentPropsChange}
          isFreeChild={style.layout === 'free'}
          onResizeStart={onResizeStart}
        />
      ))

  // 选中且为 free 子节点时显示 8 向缩放手柄
  const handles = isSelected && isFreeChild && onResizeStart
    ? <ResizeHandles onResizeStart={(e, dir) => onResizeStart(e, node.id, dir)} />
    : null

  const nodeProps = {
    'data-node-id': node.id,
    'data-highlighted': isHighlighted ? 'true' : undefined,
    'data-testid': `node-${node.id}`,
    style: { ...styleToCss(style), ...common },
    onPointerDown: (e: React.PointerEvent) => onDragStart(e, node.id),
    onClick: (e: React.MouseEvent) => {
      // 选中已在 pointerdown 处理（additive 依据 e.ctrlKey）；此处仅阻止冒泡到画布背景
      e.stopPropagation()
    },
  }

  if (node.type === 'frame' || node.type === 'group') {
    return (
      <div {...nodeProps}>
        {renderChildren()}
        {handles}
      </div>
    )
  }

  if (node.type === 'text') {
    return (
      <div {...nodeProps}>
        {(node.props?.text as string) ?? ''}
        {handles}
      </div>
    )
  }

  if (node.type === 'rect') {
    return <div {...nodeProps}>{handles}</div>
  }

  // type === 'component'
  return (
    <div {...nodeProps}>
      <RegistryComponent node={node} onComponentPropsChange={onComponentPropsChange} />
      {handles}
    </div>
  )
}
