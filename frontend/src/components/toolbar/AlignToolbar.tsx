import { alignFlex, alignFree, type AlignOp } from '@/canvas/align'
import type { NodeRect } from '@/canvas/align'
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

  /**
   * 量选中节点的**实际尺寸**（画布世界坐标 = offsetWidth/Height，缩放不影响）。
   * 测不到（节点隐藏没进 DOM / 全局 querySelector 命中多于一个投影层）返回 null ——
   * 调用方**整批不动**（2026-09-17 的教训：拿 0 当尺寸会把可见节点对齐到错误位置）。
   */
  const measureGroup = (group: string[]): NodeRect[] | null => {
    const rects = group.map((id) => {
      const node = findNode(design, id)!
      const els = document.querySelectorAll(`[data-node-id="${id}"]`)
      const el = els.length === 1 ? (els[0] as HTMLElement) : null
      return { id, x: node.x ?? 0, y: node.y ?? 0, w: el?.offsetWidth ?? 0, h: el?.offsetHeight ?? 0 }
    })
    return rects.some((r) => r.w <= 0 || r.h <= 0) ? null : rects
  }

  /**
   * 把 `alignFree` 的结果写回节点。
   *
   * 2026-09-17 修：它用 `w/h` 表达**尺寸**变更（见 `canvas/align.ts` 的 `uniform`），
   * 而节点尺寸实际存在 `style.width/height` —— 原样 spread 会被 store 丢掉
   * （`DesignStore._applyUpdate` 只认 x/y/hidden/props/style），于是「▦ 统一尺寸」**点了等于没点**
   * （E2E `align-toolbar.spec.ts` 实测：三个按钮选后点 ▦，宽度仍是 120px）。这里显式映射一次，
   * free 与 flex 两条分支共用同一段落地逻辑，避免再漂移。
   */
  const applyFreeChanges = (changes: Record<string, { x?: number; y?: number; w?: number; h?: number }>) => {
    Object.entries(changes).forEach(([id, delta]) => {
      const { w, h, ...geometry } = delta
      store.updateNode(id, (n) => ({
        ...n,
        ...geometry,
        style:
          w === undefined && h === undefined
            ? n.style
            : {
                ...(n.style ?? {}),
                ...(w !== undefined ? { width: w } : {}),
                ...(h !== undefined ? { height: h } : {}),
              },
      }))
    })
  }

  const applyAlign = (op: AlignOp) => {
    if (ids.length < 2) return
    // 要求选中节点同父（简化：取第一个选中节点的父，若某选中节点不在该父下则忽略）
    const parent = findParent(design, ids[0])
    if (!parent) return
    const siblings = parent.children ?? []
    const group = ids.filter((id) => siblings.some((s) => s.id === id))
    if (group.length < 2) return

    if (parent.style?.layout === 'free') {
      const rects = measureGroup(group)
      if (!rects) return // 测不全就整批不动（与「转自由画布」同一口径：宁可不动，也不要错位）
      applyFreeChanges(alignFree(rects, op))
    } else {
      // 2026-09-17：`alignFlex` 对 uniform 明确返回 null（父容器样式表达不了"子节点一样大"），
      // 于是 flex 下点「▦ 统一尺寸」同样是空转。这里改成按子节点逐个写尺寸，语义与 free 一致。
      if (op === 'uniform') {
        const rects = measureGroup(group)
        if (!rects) return
        applyFreeChanges(alignFree(rects, 'uniform'))
        return
      }
      /**
       * 分布：flex 下"等间距"在**主轴**上就是 `justify-content: space-between`
       * （2026-09-17：`alignFlex` 对 hspace/vspace 返回 null，原来这两个按钮在 flex 下是空转）。
       * 交叉轴（比如列布局点"水平等间距"）在 flex 里没有等价表达 → 保持不动，
       * 不静默改别的属性（宁可不做，也不要改错方向）。
       */
      if (op === 'hspace' || op === 'vspace') {
        const axis = parent.style?.layout
        const alongMainAxis = (op === 'hspace' && axis === 'row') || (op === 'vspace' && axis === 'column')
        if (!alongMainAxis) return
        store.updateNode(parent.id, (n) => ({
          ...n,
          style: { ...(n.style ?? {}), justify: 'space-between' },
        }))
        return
      }
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
