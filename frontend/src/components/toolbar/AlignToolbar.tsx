import { alignFlex, alignFree, type AlignOp } from '@/canvas/align'
import { Button } from '@/components/ui/button'
import { findNode, findParent } from '@/design/tree'
import type { DesignNode } from '@/design/types'
import type { DesignStore } from '@/yjs/designStore'

/**
 * 对齐/分布工具栏（v2.2 §3.3：选中 2 个以上节点启用）。
 * free 模式：计算坐标/尺寸直接改节点；flex 模式：改父容器 justify/alignItems。
 */
interface AlignToolbarProps {
  design: DesignNode
  selectedIds: Set<string>
  store: DesignStore
}

const OPS: Array<{ op: AlignOp; label: string; title: string }> = [
  { op: 'left', label: '⬅', title: '左对齐' },
  { op: 'hcenter', label: '⇔', title: '水平居中' },
  { op: 'right', label: '➡', title: '右对齐' },
  { op: 'top', label: '⬆', title: '顶对齐' },
  { op: 'vcenter', label: '⇕', title: '垂直居中' },
  { op: 'bottom', label: '⬇', title: '底对齐' },
  { op: 'hspace', label: '↔', title: '水平等间距' },
  { op: 'vspace', label: '↕', title: '垂直等间距' },
  { op: 'uniform', label: '▦', title: '统一尺寸' },
]

export default function AlignToolbar({ design, selectedIds, store }: AlignToolbarProps) {
  const ids = [...selectedIds]
  const enabled = ids.length >= 2

  const applyAlign = (op: AlignOp) => {
    if (ids.length < 2) return
    // 要求选中节点同父（简化：取第一个选中节点的父，若某选中节点不在该父下则忽略）
    const parent = findParent(design, ids[0])
    if (!parent) return
    const siblings = parent.children ?? []
    const group = ids.filter((id) => siblings.some((s) => s.id === id))
    if (group.length < 2) return

    if (parent.style?.layout === 'free') {
      // 测量各节点尺寸（画布世界坐标 = DOM 尺寸，缩放不影响 offsetWidth）
      const rects = group.map((id) => {
        const node = findNode(design, id)!
        const el = document.querySelector(`[data-node-id="${id}"]`) as HTMLElement | null
        return {
          id,
          x: node.x ?? 0,
          y: node.y ?? 0,
          w: el?.offsetWidth ?? 0,
          h: el?.offsetHeight ?? 0,
        }
      })
      const changes = alignFree(rects, op)
      Object.entries(changes).forEach(([id, delta]) => {
        store.updateNode(id, (n) => ({ ...n, ...delta }))
      })
    } else {
      // flex：改父容器样式
      const styleChange = alignFlex(op)
      if (styleChange) {
        store.updateNode(parent.id, (n) => ({
          ...n,
          style: { ...(n.style ?? {}), ...styleChange },
        }))
      }
    }
  }

  return (
    <div className="flex items-center gap-1" data-testid="align-toolbar">
      {OPS.map(({ op, label, title }) => (
        <Button
          key={op}
          size="sm"
          variant="ghost"
          disabled={!enabled}
          className="h-8 w-8 px-0 text-sm"
          title={`${title}${enabled ? '' : '（需选中 2 个以上节点）'}`}
          data-testid={`align-${op}`}
          onClick={() => applyAlign(op)}
        >
          {label}
        </Button>
      ))}
    </div>
  )
}
