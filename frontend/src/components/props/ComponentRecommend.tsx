/**
 * 组件智能推荐（E3-3）：按容器上下文推荐 3 个组件（图标 + 组件名 + 理由 + 预览）。
 * 两种形态：
 * - 内嵌：属性面板顶部"✨推荐组件"按钮，点击展开推荐列表
 * - 浮层：画布右键菜单触发，挂载即加载，绝对定位卡片
 * 点击推荐项 → onAdd(targetId, item) 由上层插入画布（可编辑）；"不推荐，我自己选"关闭。
 */
import { useEffect, useState } from 'react'
import { Sparkles, X } from 'lucide-react'

import { componentRegistry } from '@/components/canvas/registry'
import { Button } from '@/components/ui/button'
import type { DesignNode } from '@/design/types'
import { api } from '@/lib/api'

export interface RecommendItem {
  component_type: string
  reason: string
  suggested_index: number
  default_props: Record<string, unknown>
  target_id?: string
}

const TYPE_ICONS: Record<string, string> = {
  button: '🔘', card: '🃏', input: '⌨️', select: '🔽', table: '📊', chart: '📈',
  'stat-block': '🔢', navbar: '🧭', sidebar: '📑', avatar: '👤', tag: '🏷️',
  divider: '➖', 'title-text': '🔤', hero: '🖼️', image: '🖼️',
}

function typeLabel(type: string): string {
  return componentRegistry[type]?.label ?? type
}

interface ComponentRecommendProps {
  design: DesignNode
  containerId: string
  onAdd: (targetId: string, item: RecommendItem) => void
  /** 浮层模式：传入坐标则挂载即加载并渲染为定位卡片 */
  floating?: { x: number; y: number } | null
  onClose?: () => void
}

export default function ComponentRecommend({ design, containerId, onAdd, floating, onClose }: ComponentRecommendProps) {
  const [open, setOpen] = useState(Boolean(floating))
  const [items, setItems] = useState<RecommendItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      const resp = await api<{ recommendations: RecommendItem[] }>('/api/recommend-components', {
        method: 'POST',
        body: JSON.stringify({ design, container_id: containerId }),
      })
      setItems(resp.recommendations)
      setOpen(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : '推荐失败，请稍后重试')
    } finally {
      setLoading(false)
    }
  }

  // 浮层模式：挂载即加载
  useEffect(() => {
    if (floating) load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [floating])

  const list = (
    <div className="flex flex-col gap-2" data-testid="recommend-list">
      {items.length === 0 && !loading && (
        <p className="text-xs text-muted-foreground">当前上下文暂无推荐，试试手动添加。</p>
      )}
      {items.map((item) => {
        const label = typeLabel(item.component_type)
        return (
          <button
            key={`${item.component_type}-${item.suggested_index}`}
            className="flex items-start gap-2 rounded-lg border p-2 text-left hover:bg-accent"
            data-testid={`recommend-item-${item.component_type}`}
            onClick={() => onAdd(item.target_id ?? containerId, item)}
          >
            <span className="mt-0.5 text-base leading-none">{TYPE_ICONS[item.component_type] ?? '🧩'}</span>
            <span className="min-w-0 flex-1">
              <span className="block text-xs font-medium">
                {label}
                <span className="ml-1 text-[10px] text-muted-foreground">添加后可在属性面板编辑</span>
              </span>
              <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">{item.reason}</span>
            </span>
            <span className="mt-1 text-[10px] text-muted-foreground">+ 添加</span>
          </button>
        )
      })}
    </div>
  )

  // 浮层模式：挂载即展示
  if (floating) {
    return (
      <div
        className="absolute z-50 w-72 rounded-lg border bg-background p-3 shadow-lg"
        style={{ left: Math.min(floating.x, 260), top: floating.y }}
        data-testid="recommend-popover"
      >
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-semibold">✨ 智能推荐组件</span>
          <button className="rounded p-0.5 hover:bg-accent" data-testid="recommend-close" onClick={onClose}>
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        {loading ? (
          <p className="text-xs text-muted-foreground" data-testid="recommend-loading">AI 分析容器上下文…</p>
        ) : error ? (
          <p className="text-xs text-destructive">{error}</p>
        ) : (
          list
        )}
      </div>
    )
  }

  // 内嵌模式：按钮 + 列表
  return (
    <div className="flex flex-col gap-2" data-testid="component-recommend">
      <Button
        size="sm"
        variant="outline"
        className="h-8 w-full text-xs"
        data-testid="recommend-open"
        disabled={loading}
        onClick={() => (open ? setOpen(false) : load())}
      >
        <Sparkles className="mr-1 h-3.5 w-3.5" />
        {open ? '收起推荐' : '✨ 推荐组件'}
      </Button>
      {error && <p className="text-xs text-destructive">{error}</p>}
      {open && !error && list}
      {open && items.length > 0 && (
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-full text-xs text-muted-foreground"
          data-testid="recommend-dismiss"
          onClick={() => setOpen(false)}
        >
          不推荐，我自己选
        </Button>
      )}
    </div>
  )
}
