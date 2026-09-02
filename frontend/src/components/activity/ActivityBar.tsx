import { History, Layers, Settings, SlidersHorizontal, Sparkles, type LucideIcon } from 'lucide-react'

import { cn } from '@/lib/utils'

/** 活动栏入口（P1：图标竖排，点击展开面板，再次点击收起） */
export const ACTIVITY_ITEMS: Array<{ key: string; label: string; icon: LucideIcon }> = [
  { key: 'props', label: '属性编辑', icon: SlidersHorizontal },
  { key: 'ai', label: 'AI 生成', icon: Sparkles },
  { key: 'layers', label: '图层管理', icon: Layers },
  { key: 'history', label: '历史版本', icon: History },
  { key: 'settings', label: '设置', icon: Settings },
]

export const ACTIVITY_TITLES: Record<string, string> = Object.fromEntries(
  ACTIVITY_ITEMS.map((i) => [i.key, i.label]),
)

interface ActivityBarProps {
  active: string | null
  onSelect: (key: string) => void
}

export default function ActivityBar({ active, onSelect }: ActivityBarProps) {
  return (
    <div className="flex w-12 shrink-0 flex-col items-center gap-1 border-l bg-background py-2" data-testid="activity-bar">
      {ACTIVITY_ITEMS.map(({ key, label, icon: Icon }) => {
        const isActive = active === key
        return (
          <button
            key={key}
            className={cn(
              'rounded-md p-2 transition-colors hover:bg-accent hover:text-accent-foreground',
              isActive && 'bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground',
            )}
            title={label}
            data-testid={`activity-${key}`}
            data-active={isActive}
            onClick={() => onSelect(key)}
          >
            <Icon className="h-5 w-5" />
          </button>
        )
      })}
    </div>
  )
}
