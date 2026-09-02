import { useState } from 'react'
import { ChevronDown, ChevronRight, Copy, Eye, EyeOff, Pencil, Plus, Trash2 } from 'lucide-react'

import { genId } from '@/design/tree'

import { componentRegistry } from '@/components/canvas/registry'
import { cn } from '@/lib/utils'
import type { DesignNode } from '@/design/types'
import type { DesignStore } from '@/yjs/designStore'

/**
 * 图层管理（P1-5）：
 * - 拖拽排序（同级）与拖拽改父级（拖到容器上）
 * - 双击重命名（props.name）、眼睛切换隐藏、箭头展开/折叠
 * - 点击选中画布节点
 */
interface LayerTreeProps {
  design: DesignNode
  selectedIds: Set<string>
  onSelect: (id: string) => void
  store: DesignStore
}

function nodeLabel(node: DesignNode): string {
  if (typeof node.props?.name === 'string' && node.props.name) return node.props.name
  if (node.componentType) return componentRegistry[node.componentType]?.label ?? node.componentType
  return node.type === 'frame' ? '容器' : node.type === 'text' ? '文本' : node.type === 'rect' ? '色块' : '分组'
}

export default function LayerTree({ design, selectedIds, onSelect, store }: LayerTreeProps) {
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set())
  const [renamingId, setRenamingId] = useState<string | null>(null)
  /** 缺陷 7：右键菜单（fixed 定位，操作后关闭） */
  const [ctxMenu, setCtxMenu] = useState<{ nodeId: string; x: number; y: number } | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [dropTarget, setDropTarget] = useState<string | null>(null)

  const toggleCollapse = (id: string) => {
    setCollapsedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleDragStart = (e: React.DragEvent, id: string) => {
    e.dataTransfer.setData('design/layer-node', id)
    e.dataTransfer.effectAllowed = 'move'
  }

  const handleDrop = (e: React.DragEvent, targetId: string) => {
    e.preventDefault()
    e.stopPropagation()
    setDropTarget(null)
    const sourceId = e.dataTransfer.getData('design/layer-node')
    if (!sourceId || sourceId === targetId) return
    // 目标行是容器 → 改父级（移入末尾）；否则 → 同父排序（插到目标行位置）
    const target = findNodeById(design, targetId)
    const source = findNodeById(design, sourceId)
    if (!target || !source) return
    const targetHasChildren = !!target.children?.length && target.type !== 'text'
    const sourceParent = findParentOf(design, sourceId)
    if (targetHasChildren) {
      store.moveNodeTo(sourceId, targetId, (target.children ?? []).length)
    } else if (sourceParent && sourceParent.id === findParentOf(design, targetId)?.id) {
      const siblings = sourceParent.children ?? []
      const toIndex = siblings.findIndex((s) => s.id === targetId)
      store.moveChild(sourceId, sourceParent.id, toIndex >= 0 ? toIndex : siblings.length)
    }
  }

  const startRename = (node: DesignNode) => {
    setRenamingId(node.id)
    setRenameValue(nodeLabel(node))
  }

  const commitRename = (id: string) => {
    const value = renameValue.trim()
    if (value) {
      store.updateNode(id, (n) => ({ ...n, props: { ...(n.props ?? {}), name: value } }))
    }
    setRenamingId(null)
  }

  const toggleHidden = (id: string) => {
    store.updateNode(id, (n) => ({ ...n, hidden: !n.hidden }))
  }

  const renderNode = (node: DesignNode, depth: number) => {
    const selected = selectedIds.has(node.id)
    const isCollapsed = collapsedIds.has(node.id)
    const hasChildren = !!node.children?.length
    const isDropTarget = dropTarget === node.id
    const isRenaming = renamingId === node.id

    return (
      <div key={node.id}>
        <div
          className={cn(
            'group flex items-center gap-1 rounded px-1 py-1 text-xs hover:bg-accent',
            selected && 'bg-primary text-primary-foreground hover:bg-primary',
            isDropTarget && 'bg-amber-100 outline outline-2 outline-amber-400 dark:bg-amber-900/40',
          )}
          style={{ paddingLeft: depth * 14 + 4 }}
          data-testid={`layer-${node.id}`}
          data-selected={selected}
          draggable
          onDragStart={(e) => handleDragStart(e, node.id)}
          onDragOver={(e) => {
            e.preventDefault()
            e.stopPropagation()
            setDropTarget(node.id)
          }}
          onDragLeave={() => setDropTarget(null)}
          onDrop={(e) => handleDrop(e, node.id)}
          onDragEnd={() => setDropTarget(null)}
          onClick={() => {
            setCtxMenu(null)
            onSelect(node.id)
          }}
          onDoubleClick={() => startRename(node)}
          onContextMenu={(e) => {
            e.preventDefault()
            e.stopPropagation()
            setCtxMenu({ nodeId: node.id, x: e.clientX, y: e.clientY })
          }}
        >
          {hasChildren ? (
            <button
              className="shrink-0 rounded p-0.5 hover:bg-black/10"
              data-testid={`layer-toggle-${node.id}`}
              onClick={(e) => {
                e.stopPropagation()
                toggleCollapse(node.id)
              }}
            >
              {isCollapsed ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            </button>
          ) : (
            <span className="w-4 shrink-0" />
          )}
          <button
            className="shrink-0 rounded p-0.5 opacity-0 hover:bg-black/10 group-hover:opacity-100"
            data-testid={`layer-hide-${node.id}`}
            title={node.hidden ? '显示' : '隐藏'}
            onClick={(e) => {
              e.stopPropagation()
              toggleHidden(node.id)
            }}
          >
            {node.hidden ? <EyeOff className="h-3 w-3 opacity-60" /> : <Eye className="h-3 w-3" />}
          </button>
          {isRenaming ? (
            <input
              className="w-full min-w-0 rounded border border-primary bg-background px-1 py-0.5 text-xs text-foreground"
              data-testid={`layer-rename-input-${node.id}`}
              value={renameValue}
              autoFocus
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => setRenameValue(e.target.value)}
              onBlur={() => commitRename(node.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitRename(node.id)
                if (e.key === 'Escape') setRenamingId(null)
              }}
            />
          ) : (
            <span className={cn('truncate', node.hidden && 'opacity-40 line-through')}>{nodeLabel(node)}</span>
          )}
          <span className="ml-auto shrink-0 text-[10px] opacity-40">{node.id.slice(0, 8)}</span>
        </div>
        {hasChildren && !isCollapsed && (
          <div data-testid={`layer-children-${node.id}`}>
            {node.children!.map((child) => renderNode(child, depth + 1))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto p-2" data-testid="layer-tree">
      <div className="flex items-center justify-between px-2 pb-2 text-xs text-muted-foreground">
        <span>点击选中 · 拖拽排序/改父级 · 右键更多操作</span>
        <Pencil className="h-3 w-3 opacity-50" />
      </div>
      {renderNode(design, 0)}
      {/* 缺陷 7：右键菜单（复制/重命名/删除/插入子级） */}
      {ctxMenu && (
        <div
          className="fixed z-50 w-36 rounded-lg border bg-background p-1 shadow-lg"
          style={{ left: ctxMenu.x, top: ctxMenu.y }}
          data-testid="layer-context-menu"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <button
            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-accent"
            data-testid="layer-ctx-duplicate"
            onClick={() => {
              store.duplicateNode(ctxMenu.nodeId)
              setCtxMenu(null)
            }}
          >
            <Copy className="h-3 w-3" /> 复制
          </button>
          <button
            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-accent"
            data-testid="layer-ctx-rename"
            onClick={() => {
              const node = findNodeById(design, ctxMenu.nodeId)
              if (node) startRename(node)
              setCtxMenu(null)
            }}
          >
            <Pencil className="h-3 w-3" /> 重命名
          </button>
          {['frame', 'group'].includes(ctxMenuNodeType(ctxMenu.nodeId, design)) && (
            <button
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-accent"
              data-testid="layer-ctx-insert"
              onClick={() => {
                store.insertChild(ctxMenu.nodeId, {
                  id: genId('text'),
                  type: 'text',
                  props: { text: '新文本' },
                  style: { fontSize: 14 },
                })
                setCtxMenu(null)
              }}
            >
              <Plus className="h-3 w-3" /> 插入子级
            </button>
          )}
          <div className="my-1 border-t" />
          <button
            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-destructive hover:bg-accent"
            data-testid="layer-ctx-delete"
            onClick={() => {
              store.removeNode(ctxMenu.nodeId)
              setCtxMenu(null)
            }}
          >
            <Trash2 className="h-3 w-3" /> 删除
          </button>
        </div>
      )}
    </div>
  )
}

/** 右键菜单辅助：节点是否容器（可插子级） */
function ctxMenuNodeType(nodeId: string, design: DesignNode): string {
  const node = findNodeById(design, nodeId)
  return node?.type ?? ''
}

function findNodeById(node: DesignNode, id: string): DesignNode | null {
  if (node.id === id) return node
  for (const child of node.children ?? []) {
    const hit = findNodeById(child, id)
    if (hit) return hit
  }
  return null
}

function findParentOf(node: DesignNode, id: string): DesignNode | null {
  for (const child of node.children ?? []) {
    if (child.id === id) return node
    const hit = findParentOf(child, id)
    if (hit) return hit
  }
  return null
}
