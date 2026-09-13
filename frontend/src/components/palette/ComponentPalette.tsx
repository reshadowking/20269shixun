import { useCallback } from 'react'
import {
  BarChart3, ChevronLeft, ChevronRight, CreditCard, Heading, Image as ImageIcon,
  ListFilter, Minus, MousePointerClick, PanelLeft, PanelTop, SquarePen, Star, Table as TableIcon, ToggleLeft,
  Tag as TagIcon, TrendingUp, UserRound, type LucideIcon,
} from 'lucide-react'

import { componentPalette } from '@/components/canvas/registry'
import { Button } from '@/components/ui/button'
import { genId } from '@/design/tree'
import type { DesignNode } from '@/design/types'

/** 组件 → 图标映射（统一线性图标，P7 视觉规范） */
const COMPONENT_ICONS: Record<string, LucideIcon> = {
  button: MousePointerClick,
  card: CreditCard,
  input: SquarePen,
  select: ListFilter,
  table: TableIcon,
  chart: BarChart3,
  'stat-block': TrendingUp,
  navbar: PanelTop,
  sidebar: PanelLeft,
  avatar: UserRound,
  tag: TagIcon,
  divider: Minus,
  'title-text': Heading,
  hero: ImageIcon,
  image: ImageIcon,
  icon: Star,
  switch: ToggleLeft,
}

/** 组件面板（P2：受控折叠为图标列；点击添加 + 拖拽到画布添加） */
export default function ComponentPalette({
  collapsed,
  onToggle,
  onAdd,
}: {
  collapsed: boolean
  onToggle: () => void
  onAdd: (node: DesignNode) => void
}) {
  const handleDragStart = useCallback(
    (e: React.DragEvent, type: string) => {
      e.dataTransfer.setData('application/design-component', type)
      e.dataTransfer.effectAllowed = 'copy'
    },
    [],
  )

  const addNode = (type: string) => {
    onAdd({
      id: genId(type),
      type: 'component',
      componentType: type as DesignNode['componentType'],
      props: {},
      style: { width: 200 },
    })
  }

  if (collapsed) {
    return (
      <div className="flex h-full flex-col items-center gap-1 overflow-y-auto p-2" data-testid="component-palette-collapsed">
        <button
          className="mb-1 rounded p-1.5 hover:bg-accent"
          data-testid="palette-expand"
          title="展开组件库"
          onClick={onToggle}
        >
          <ChevronRight className="h-4 w-4" />
        </button>
        {componentPalette.map(({ type, label }) => {
          const Icon = COMPONENT_ICONS[type] ?? SquarePen
          return (
            <button
              key={type}
              className="rounded p-1.5 hover:bg-accent"
              data-testid={`palette-icon-${type}`}
              title={label}
              draggable
              onDragStart={(e) => handleDragStart(e, type)}
              onClick={() => addNode(type)}
            >
              <Icon className="h-4 w-4" />
            </button>
          )
        })}
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col gap-2 overflow-y-auto p-3" data-testid="component-palette">
      <div className="flex items-center justify-between">
        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">组件库</div>
        <button
          className="rounded p-1 hover:bg-accent"
          data-testid="palette-collapse"
          title="收起组件库"
          onClick={onToggle}
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {componentPalette.map(({ type, label }) => (
          <Button
            key={type}
            variant="outline"
            size="sm"
            className="h-9 justify-start gap-1.5 text-xs"
            data-testid={`palette-${type}`}
            draggable
            onDragStart={(e) => handleDragStart(e, type)}
            onClick={() => addNode(type)}
          >
            {(() => {
              const Icon = COMPONENT_ICONS[type] ?? SquarePen
              return <Icon className="h-3.5 w-3.5 shrink-0" />
            })()}
            {label}
          </Button>
        ))}
      </div>
      <p className="text-[11px] text-muted-foreground">点击添加，或拖拽到画布任意位置</p>
    </div>
  )
}
