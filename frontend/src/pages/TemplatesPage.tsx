/**
 * T36：「模板库」页（侧边栏入口）。复用既有 `/api/generate/templates`，
 * 选模板 → 直接进工作台并带上 `?template=<key>`（工作台已有该参数处理）。
 */
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { api } from '@/lib/api'

interface TemplateRow {
  key: string
  name: string
}

export default function TemplatesPage() {
  const navigate = useNavigate()
  const [rows, setRows] = useState<TemplateRow[]>([])
  const [error, setError] = useState('')

  useEffect(() => {
    api<{ templates: TemplateRow[] }>('/api/generate/templates')
      .then((resp) => setRows(resp.templates))
      .catch((err) => setError(err instanceof Error ? err.message : '加载失败'))
  }, [])

  return (
    <div className="mx-auto max-w-[1080px] px-8 py-8" data-testid="templates-page">
      <div className="mb-5 flex items-baseline gap-3">
        <h1 className="text-lg font-semibold">模板库</h1>
        <span className="text-xs text-muted-foreground">选一个骨架起点，进入工作台后可继续用 AI 修改</span>
      </div>
      {error && <p className="mb-3 text-xs text-destructive">{error}</p>}
      <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3">
        {rows.map((row) => (
          <button
            key={row.key}
            className="overflow-hidden rounded-xl border border-border bg-card text-left transition hover:border-primary/40"
            data-testid={`template-${row.key}`}
            onClick={() => navigate(`/workspace?template=${row.key}`)}
          >
            <div className="h-[78px] bg-muted/40 p-3">
              <div className="mb-1.5 h-1.5 w-2/5 rounded-full bg-foreground/15" />
              <div className="mb-1.5 h-1.5 w-3/5 rounded-full bg-foreground/10" />
              <div className="h-3 w-10 rounded-full bg-primary/70" />
            </div>
            <div className="border-t border-border px-3 py-2 text-xs text-muted-foreground">{row.name}</div>
          </button>
        ))}
      </div>
    </div>
  )
}
