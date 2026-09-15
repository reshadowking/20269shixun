/**
 * T36：「我的项目」页（从首页列表迁出，逻辑与既有实现一致：分页 / 删除确认 / 空态）。
 * 数据仍走既有 `/api/designs`，不新增后端契约。
 */
import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import DesignThumbnail from '@/components/chat/DesignThumbnail'
import { api } from '@/lib/api'
import type { DesignNode } from '@/design/types'

interface DesignRow {
  id: number
  name: string
  updated_at: string | null
  design?: DesignNode
}

const PAGE_SIZE = 12

export default function ProjectsPage() {
  const navigate = useNavigate()
  const [rows, setRows] = useState<DesignRow[]>([])
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async (nextOffset: number) => {
    setLoading(true)
    setError('')
    try {
      const resp = await api<{ designs: DesignRow[]; total: number }>(
        `/api/designs?limit=${PAGE_SIZE}&offset=${nextOffset}&with_preview=true`,
      )
      setRows(resp.designs)
      setTotal(resp.total)
      setOffset(nextOffset)
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load(0)
  }, [load])

  const remove = async (row: DesignRow) => {
    if (!window.confirm(`删除「${row.name}」？历史版本将一并删除。`)) return
    try {
      await api(`/api/designs/${row.id}`, { method: 'DELETE' })
      load(offset)
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败')
    }
  }

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const page = Math.floor(offset / PAGE_SIZE) + 1

  return (
    <div className="mx-auto max-w-[1080px] px-8 py-8" data-testid="projects-page">
      <div className="mb-5 flex items-center gap-3">
        <h1 className="text-lg font-semibold">我的项目</h1>
        <span className="text-xs text-muted-foreground">共 {total} 个设计稿</span>
        <button
          className="ml-auto rounded-md border border-border px-3 py-1.5 text-xs hover:bg-accent"
          data-testid="projects-new"
          onClick={() => navigate('/workspace')}
        >
          ＋ 新建画布
        </button>
      </div>

      {error && <p className="mb-3 text-xs text-destructive">{error}</p>}
      {loading && <p className="text-xs text-muted-foreground">加载中…</p>}

      {!loading && rows.length === 0 && (
        <div
          className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground"
          data-testid="projects-empty"
        >
          还没有保存的设计 · 生成第一稿后，这里会出现它的缩略预览
        </div>
      )}

      <div className="grid grid-cols-[repeat(auto-fill,minmax(208px,1fr))] gap-3">
        {rows.map((row) => (
          <div
            key={row.id}
            className="overflow-hidden rounded-xl border border-border bg-card transition hover:border-primary/40"
            data-testid={`project-card-${row.id}`}
          >
            <button
              className="block w-full text-left"
              data-testid={`project-open-${row.id}`}
              onClick={() => navigate(`/workspace?design=${row.id}`)}
            >
              <div className="h-[122px] overflow-hidden bg-muted/40 px-3 py-3">
                {row.design ? (
                  <DesignThumbnail design={row.design} />
                ) : (
                  <div className="h-full w-full rounded-lg border border-dashed border-border" />
                )}
              </div>
            </button>
            <div className="flex items-center gap-2 border-t border-border px-3 py-2">
              <span className="truncate text-[13px] font-medium">{row.name}</span>
              <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">
                {row.updated_at ? new Date(row.updated_at).toLocaleDateString() : ''}
              </span>
              <button
                className="shrink-0 text-[11px] text-muted-foreground hover:text-destructive"
                data-testid={`project-delete-${row.id}`}
                onClick={() => remove(row)}
              >
                删除
              </button>
            </div>
          </div>
        ))}
      </div>

      {pages > 1 && (
        <div className="mt-5 flex items-center gap-3 text-xs">
          <button
            className="rounded-md border border-border px-3 py-1 disabled:opacity-40"
            data-testid="projects-prev"
            disabled={offset === 0}
            onClick={() => load(Math.max(0, offset - PAGE_SIZE))}
          >
            上一页
          </button>
          <span className="text-muted-foreground">
            {page} / {pages}
          </span>
          <button
            className="rounded-md border border-border px-3 py-1 disabled:opacity-40"
            data-testid="projects-next"
            disabled={page >= pages}
            onClick={() => load(offset + PAGE_SIZE)}
          >
            下一页
          </button>
        </div>
      )}
    </div>
  )
}
