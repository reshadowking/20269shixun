import { Code, History, Layers, Palette, Settings, SlidersHorizontal, Sparkles, type LucideIcon } from 'lucide-react'

import { cn } from '@/lib/utils'

/** 活动栏入口（P1：图标竖排，点击展开面板，再次点击收起） */
export const ACTIVITY_ITEMS: Array<{ key: string; label: string; icon: LucideIcon }> = [
  { key: 'props', label: '属性编辑', icon: SlidersHorizontal },
  { key: 'beautify', label: '美化效果', icon: Palette },
  { key: 'ai', label: 'AI 生成', icon: Sparkles },
  { key: 'layers', label: '图层管理', icon: Layers },
  { key: 'history', label: '历史版本', icon: History },
  { key: 'code', label: '代码', icon: Code },
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
    <div className="flex w-12 shrink-0 flex-col items-center gap-1.5 border-l bg-muted/30 py-3" data-testid="activity-bar">
      {ACTIVITY_ITEMS.map(({ key, label, icon: Icon }) => {
        const isActive = active === key
        return (
          <div key={key} className="relative">
            {/* 选中指示条：比整块高亮更克制，接近主流设计工具的侧栏语言 */}
            <span
              className={cn(
                'absolute -left-1.5 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-primary transition-opacity',
                isActive ? 'opacity-100' : 'opacity-0',
              )}
            />
            <button
              className={cn(
                'rounded-lg p-2 text-muted-foreground transition-all hover:bg-accent hover:text-accent-foreground',
                isActive && 'bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary',
              )}
              title={label}
              data-testid={`activity-${key}`}
              data-active={isActive}
              onClick={() => onSelect(key)}
            >
              <Icon className="h-5 w-5" />
            </button>
          </div>
        )
      })}
    </div>
  )
}
