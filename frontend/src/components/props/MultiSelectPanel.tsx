/**
 * 多选属性编辑面板（缺陷 1）：多个选中节点的共有样式字段批量修改。
 * 仅展示所有节点"都存在"的样式键；值不一致显示"混合"；修改经 updateMany 单事务应用。
 */
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { DesignNode, NodeStyle } from '@/design/types'

interface MultiSelectPanelProps {
  nodes: DesignNode[]
  onUpdateMany: (updater: (node: DesignNode) => DesignNode) => void
  onDeleteAll: () => void
}

/** 可批量编辑的样式键（与属性面板 STYLE_FIELDS 对齐的公共子集） */
const COMMON_KEYS: (keyof NodeStyle)[] = ['layout', 'gap', 'padding', 'fontSize', 'fontWeight', 'width', 'height', 'radius', 'color', 'background']

const KEY_LABELS: Record<string, string> = {
  layout: '布局', gap: '间距', padding: '内边距', fontSize: '字号', fontWeight: '字重',
  width: '宽度', height: '高度', radius: '圆角', color: '文字颜色', background: '背景颜色',
}

function mixedValue(nodes: DesignNode[], key: keyof NodeStyle): unknown | 'mixed' {
  const values = new Set(nodes.map((n) => n.style?.[key]))
  if (values.size === 1) return [...values][0]
  return 'mixed'
}

export default function MultiSelectPanel({ nodes, onUpdateMany, onDeleteAll }: MultiSelectPanelProps) {
  // 只显示所有节点都具备的键（避免给单节点键批量塞值）
  const presentKeys = COMMON_KEYS.filter((key) => nodes.every((n) => n.style?.[key] !== undefined))

  const NUMERIC_KEYS = new Set<keyof NodeStyle>(['gap', 'padding', 'fontSize', 'fontWeight', 'width', 'height', 'radius'])

  const setKey = (key: keyof NodeStyle, value: unknown) => {
    const parsed = NUMERIC_KEYS.has(key) && typeof value === 'string' && value !== '' ? Number(value) : value
    onUpdateMany((n) => ({ ...n, style: { ...(n.style ?? {}), [key]: parsed } }))
  }

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-4" data-testid="multi-select-panel">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">多选编辑</div>
      <div className="text-sm font-medium">已选 {nodes.length} 个节点</div>

      {presentKeys.length === 0 && (
        <p className="text-xs text-muted-foreground">所选节点没有共有的样式属性，可拖动/对齐/删除。</p>
      )}

      {presentKeys.map((key) => {
        const value = mixedValue(nodes, key)
        const display = value === 'mixed' ? '' : String(value ?? '')
        return (
          <div key={key} className="flex flex-col gap-1">
            <Label className="text-xs">{KEY_LABELS[String(key)] ?? String(key)}</Label>
            {key === 'layout' ? (
              <select
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                data-testid={`multi-${key}`}
                value={display}
                onChange={(e) => setKey(key, e.target.value)}
              >
                {['row', 'column', 'grid', 'free'].map((o) => (
                  <option key={o} value={o}>{o}</option>
                ))}
              </select>
            ) : (
              <Input
                className="h-8 text-xs"
                data-testid={`multi-${key}`}
                type={key === 'color' || key === 'background' ? 'color' : 'text'}
                value={display}
                placeholder={value === 'mixed' ? '混合（点此输入统一值）' : undefined}
                onChange={(e) => setKey(key, e.target.value)}
              />
            )}
          </div>
        )
      })}

      <div className="mt-auto border-t pt-3">
        <Button variant="destructive" size="sm" className="w-full" data-testid="multi-delete-all" onClick={onDeleteAll}>
          删除全部选中（{nodes.length}）
        </Button>
      </div>
    </div>
  )
}
