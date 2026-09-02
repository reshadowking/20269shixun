/**
 * 历史版本面板（缺陷 16/17）：版本列表（保存时间/备注）、恢复当前设计、
 * 手动保存当前版本（带备注）。
 */
import { useCallback, useEffect, useState } from 'react'
import { History, RotateCcw, Save } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { DesignNode } from '@/design/types'
import { api } from '@/lib/api'

interface VersionItem {
  id: number
  version_no: number
  note: string
  created_at: string | null
  design: DesignNode
}

interface HistoryPanelProps {
  design: DesignNode
  /** 未保存的设计无历史版本，仅提示先保存 */
  savedId?: number
  onRestore: (design: DesignNode) => void
  onVersionSaved: () => void
}

export default function HistoryPanel({ savedId, onRestore, onVersionSaved }: HistoryPanelProps) {
  const [versions, setVersions] = useState<VersionItem[]>([])
  const [note, setNote] = useState('')
  const [msg, setMsg] = useState('')

  const refresh = useCallback(async () => {
    if (savedId === undefined) {
      setVersions([])
      return
    }
    try {
      const r = await api<{ versions: VersionItem[] }>(`/api/designs/${savedId}/versions`)
      setVersions(r.versions)
    } catch {
      setVersions([])
    }
  }, [savedId])

  useEffect(() => {
    refresh()
  }, [refresh, savedId])

  const handleSaveVersion = async () => {
    if (savedId === undefined) return
    try {
      await api(`/api/designs/${savedId}/versions`, { method: 'POST', body: JSON.stringify({ note }) })
      setNote('')
      setMsg('已保存当前版本 ✓')
      onVersionSaved()
      refresh()
    } catch {
      setMsg('保存失败')
    }
  }

  const handleRestore = (v: VersionItem) => {
    if (!window.confirm(`恢复到 v${v.version_no}？将覆盖当前设计（可先保存当前版本）。`)) return
    onRestore(v.design)
    setMsg(`已恢复到 v${v.version_no}`)
  }

  if (savedId === undefined) {
    return (
      <div className="p-4 text-xs text-muted-foreground" data-testid="history-unsaved">
        当前设计尚未保存。<br />先点右上角「💾 保存」后，历史版本会记录在这里。
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto p-4" data-testid="history-panel">
      <div className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <History className="h-3.5 w-3.5" /> 历史版本
      </div>

      {/* 手动保存当前版本 */}
      <div className="flex gap-2">
        <Input
          className="h-8 text-xs"
          data-testid="history-note-input"
          placeholder="备注（如：完成主流程）"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleSaveVersion()
          }}
        />
        <Button size="sm" variant="outline" className="h-8 shrink-0 text-xs" data-testid="history-save-version" onClick={handleSaveVersion}>
          <Save className="mr-1 h-3 w-3" /> 存版本
        </Button>
      </div>
      {msg && <p className="text-[11px] text-emerald-600" data-testid="history-msg">{msg}</p>}

      {versions.length === 0 ? (
        <p className="text-xs text-muted-foreground">暂无历史版本。保存设计时会自动记录。</p>
      ) : (
        <div className="flex flex-col gap-2" data-testid="history-list">
          {versions.map((v) => (
            <div key={v.id} className="flex items-center justify-between rounded-lg border p-2">
              <div className="min-w-0">
                <div className="text-xs font-medium">v{v.version_no}{v.note ? ` · ${v.note}` : ''}</div>
                <div className="text-[11px] text-muted-foreground">
                  {v.created_at ? new Date(v.created_at).toLocaleString('zh-CN') : ''} · {v.design ? 节点数(v.design) : 0} 节点
                </div>
              </div>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 shrink-0 text-xs"
                data-testid={`history-restore-${v.version_no}`}
                onClick={() => handleRestore(v)}
              >
                <RotateCcw className="mr-1 h-3 w-3" /> 恢复
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function 节点数(node: DesignNode): number {
  let count = 1
  for (const c of node.children ?? []) count += 节点数(c)
  return count
}
