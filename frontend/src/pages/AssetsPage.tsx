/**
 * T38：「我的资产」——按用户隔离的素材库。
 *
 * 后端：`GET /api/images`（只返回本人 + 已用容量与配额）、`POST /api/images`（上传，类型/单文件/配额三重校验）、
 * `DELETE /api/images/{id}`（仅限本人）。前端只做展示与操作，不做任何本地存储（避免"换设备就丢"）。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { api } from '@/lib/api'

interface AssetRow {
  id: number
  filename: string
  url: string
  size: number
  created_at: string | null
}

interface AssetList {
  images: AssetRow[]
  used_bytes: number
  limit_count: number
  limit_bytes: number
}

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

export default function AssetsPage() {
  const navigate = useNavigate()
  const fileRef = useRef<HTMLInputElement>(null)
  const [data, setData] = useState<AssetList | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setData(await api<AssetList>('/api/images'))
      setMessage('')
    } catch (err) {
      setMessage(err instanceof Error ? err.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const upload = async (file: File) => {
    setBusy(true)
    try {
      const form = new FormData()
      form.append('file', file)
      const token = localStorage.getItem('design-tool-token')
      const resp = await fetch('/api/images', {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        body: form, // 不要手动设 Content-Type：浏览器要自己带 multipart 边界
      })
      if (!resp.ok) {
        const body = await resp.json().catch(() => ({}))
        throw new Error(body.detail ?? `上传失败（${resp.status}）`)
      }
      setMessage('上传成功，已加入「我的资产」。')
      await load()
    } catch (err) {
      setMessage(err instanceof Error ? err.message : '上传失败')
    } finally {
      setBusy(false)
    }
  }

  const remove = async (row: AssetRow) => {
    if (!window.confirm(`删除「${row.filename}」？引用它的设计稿将显示为缺图。`)) return
    try {
      await api(`/api/images/${row.id}`, { method: 'DELETE' })
      await load()
      setMessage('已删除。')
    } catch (err) {
      setMessage(err instanceof Error ? err.message : '删除失败')
    }
  }

  /** 复制图片链接：在画布选中「图片」组件后，属性面板粘贴即可（下一步可做成一键插入）。 */
  const copyUrl = async (row: AssetRow) => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${row.url}`)
      setMessage('链接已复制：在画布选中图片组件 → 属性面板粘贴到「图片地址」。')
    } catch {
      setMessage(`复制失败，请手动复制：${row.url}`)
    }
  }

  const used = data?.used_bytes ?? 0
  const count = data?.images.length ?? 0

  return (
    <div className="mx-auto max-w-[1080px] px-8 py-8" data-testid="assets-page">
      <div className="mb-1 flex items-center gap-3">
        <h1 className="text-lg font-semibold">我的资产</h1>
        <span className="text-xs text-muted-foreground" data-testid="assets-usage">
          {count}/{data?.limit_count ?? '—'} 张 · 已用 {humanSize(used)} / {humanSize(data?.limit_bytes ?? 0)}
        </span>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          data-testid="asset-input"
          style={{ display: 'none' }}
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) void upload(file)
            e.target.value = ''
          }}
        />
        <button
          className="ml-auto rounded-md border border-border px-3 py-1.5 text-xs hover:bg-accent disabled:opacity-50"
          data-testid="asset-upload"
          disabled={busy}
          onClick={() => fileRef.current?.click()}
        >
          {busy ? '上传中…' : '⬆ 上传图片'}
        </button>
      </div>
      <p className="mb-3 text-xs text-muted-foreground">
        支持 png / jpg / webp / gif，单文件 ≤2MB；资产按账号隔离，导出时图片会内联进工程（不会丢图）。
      </p>
      {message && (
        <p className="mb-3 text-xs text-muted-foreground" data-testid="assets-msg">
          {message}
        </p>
      )}

      {loading && <p className="text-xs text-muted-foreground">加载中…</p>}

      {!loading && count === 0 && (
        <div
          className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground"
          data-testid="assets-empty"
        >
          还没有上传任何素材 · 点右上「⬆ 上传图片」开始，或在画布中选中图片组件上传
        </div>
      )}

      <div className="grid grid-cols-[repeat(auto-fill,minmax(196px,1fr))] gap-3">
        {(data?.images ?? []).map((row) => (
          <div
            key={row.id}
            className="overflow-hidden rounded-xl border border-border bg-card"
            data-testid={`asset-card-${row.id}`}
          >
            <div className="flex h-[122px] items-center justify-center bg-muted/40 p-2">
              <img src={row.url} alt={row.filename} className="max-h-full max-w-full object-contain" />
            </div>
            <div className="border-t border-border px-3 py-2">
              <div className="truncate text-[13px] font-medium" title={row.filename}>
                {row.filename}
              </div>
              <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
                <span>{humanSize(row.size)}</span>
                <span>{row.created_at ? new Date(row.created_at).toLocaleDateString() : ''}</span>
              </div>
              <div className="mt-1.5 flex items-center gap-2">
                <button
                  className="rounded border border-border px-2 py-0.5 text-[11px] hover:bg-accent"
                  data-testid={`asset-copy-${row.id}`}
                  onClick={() => copyUrl(row)}
                >
                  复制链接
                </button>
                <button
                  className="rounded border border-border px-2 py-0.5 text-[11px] text-muted-foreground hover:text-destructive"
                  data-testid={`asset-delete-${row.id}`}
                  onClick={() => remove(row)}
                >
                  删除
                </button>
                <button
                  className="ml-auto text-[11px] text-primary hover:underline"
                  data-testid={`asset-use-${row.id}`}
                  onClick={() => navigate('/workspace')}
                >
                  去画布插入 →
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
