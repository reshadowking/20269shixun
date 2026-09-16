/**
 * T38：「我的资产」——按用户隔离的素材库。
 *
 * 后端：`GET /api/images`（本人资产 + 配额）、`POST /api/images`（上传）、
 * `DELETE /api/images/{id}`（仅本人；被引用时 409，可 force）。
 * T46b：每张图可切可见性 `private / workspace / public-link`，并显示被多少稿件引用。
 * 前端只做展示与操作，不做任何本地存储（避免"换设备就丢"）。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { ASSET_VIEWS, ASSET_VIEW_LABEL, readAssetView, writeAssetView, type AssetView } from '@/lib/assetView'
import { api } from '@/lib/api'

interface AssetRow {
  id: number
  filename: string
  url: string
  /** T46b：public-link 档位的链接（带 k 凭证，未登录也能读） */
  public_url: string
  visibility: string
  /** T44：所属文件夹（null = 未分组） */
  folder_id: number | null
  /** T46b：有多少份设计稿引用了它（删之前先看这个） */
  referenced_by: number
  size: number
  created_at: string | null
}

interface FolderRow {
  id: number
  name: string
  count: number
}

interface FolderList {
  folders: FolderRow[]
  ungrouped: number
  limit_folders: number
}

/** T44：当前浏览范围——全部 / 未分组 / 某个文件夹 */
type Scope = 'all' | 'none' | number

const VISIBILITY_LABEL: Record<string, string> = {
  private: '私有（仅自己可读）',
  workspace: '工作区可见',
  'public-link': '公开链接（凭链接可读）',
}

/** T45：各视图的网格密度（大图标=现有卡片；小图标更密；平铺居中） */
const GRID_CLASS: Record<Exclude<AssetView, 'details'>, string> = {
  small: 'grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-2',
  large: 'grid grid-cols-[repeat(auto-fill,minmax(196px,1fr))] gap-3',
  tiles: 'grid grid-cols-[repeat(auto-fill,minmax(168px,1fr))] gap-2.5',
}

/**
 * T45：可见性 / 文件夹两个下拉在**所有视图**里复用。
 * 换视图不能把功能换没了——这是"展示方式"这类改动的第一约束。
 */
function AssetSelectors({
  row,
  folders,
  compact = false,
  onVisibility,
  onFolder,
}: {
  row: AssetRow
  folders: FolderRow[]
  compact?: boolean
  onVisibility: (value: string) => void
  onFolder: (value: string) => void
}) {
  const cls = `w-full rounded border border-input bg-background px-1 ${
    compact ? 'h-6 text-[10px]' : 'h-7 text-[11px]'
  }`
  return (
    <div className="mt-1 flex flex-col gap-1">
      <select
        className={cls}
        data-testid={`asset-visibility-${row.id}`}
        value={row.visibility}
        title="谁能读到这张图"
        onChange={(e) => onVisibility(e.target.value)}
      >
        <option value="private">私有（仅自己）</option>
        <option value="workspace">工作区可见</option>
        <option value="public-link">公开链接</option>
      </select>
      <select
        className={cls}
        data-testid={`asset-folder-${row.id}`}
        value={row.folder_id === null || row.folder_id === undefined ? '' : String(row.folder_id)}
        title="移动到文件夹"
        onChange={(e) => onFolder(e.target.value)}
      >
        <option value="">未分组</option>
        {folders.map((f) => (
          <option key={f.id} value={f.id}>
            {f.name}
          </option>
        ))}
      </select>
    </div>
  )
}

/** T45：操作按钮组（所有视图复用：复制链接 / 删除 / 插入到画布） */
function AssetActions({
  row,
  onCopy,
  onDelete,
  onUse,
}: {
  row: AssetRow
  onCopy: () => void
  onDelete: () => void
  onUse: () => void
}) {
  const btn = 'rounded border border-border px-1.5 py-0.5 text-[11px] hover:bg-accent'
  return (
    <div className="mt-1.5 flex items-center gap-1">
      <button className={btn} data-testid={`asset-copy-${row.id}`} onClick={onCopy}>
        复制链接
      </button>
      <button
        className={`${btn} text-muted-foreground hover:text-destructive`}
        data-testid={`asset-delete-${row.id}`}
        onClick={onDelete}
      >
        删除
      </button>
      <button className="ml-auto text-[11px] text-primary hover:underline" data-testid={`asset-use-${row.id}`} onClick={onUse}>
        插入 →
      </button>
    </div>
  )
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
  const [scope, setScope] = useState<Scope>('all')
  /** T45：展示方式（记住上次选择） */
  const [view, setView] = useState<AssetView>(() => readAssetView())
  const [folders, setFolders] = useState<FolderList>({ folders: [], ungrouped: 0, limit_folders: 0 })
  /** 2026-09-16 拖拽排序：记录正在拖的 id（用 state 而不是 dataTransfer——jsdom 里也可测） */
  const [draggingAssetId, setDraggingAssetId] = useState<number | null>(null)
  const [draggingFolderId, setDraggingFolderId] = useState<number | null>(null)

  /**
   * T44：文件夹单独取，失败也不拖垮资产列表（后端版本落后 / 接口 404 时，
   * 资产列表照常显示，只是没有文件夹栏——不制造"整页打不开"）。
   */
  const loadFolders = useCallback(async () => {
    try {
      const r = await api<FolderList>('/api/asset-folders')
      setFolders({ folders: r.folders ?? [], ungrouped: r.ungrouped ?? 0, limit_folders: r.limit_folders ?? 0 })
    } catch {
      setFolders({ folders: [], ungrouped: 0, limit_folders: 0 })
    }
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const query = scope === 'all' ? '' : `?folder_id=${scope === 'none' ? 'none' : scope}`
      setData(await api<AssetList>(`/api/images${query}`))
      void loadFolders()
      setMessage('')
    } catch (err) {
      setMessage(err instanceof Error ? err.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }, [scope, loadFolders])

  useEffect(() => {
    void load()
  }, [load])

  const upload = async (file: File) => {
    setBusy(true)
    try {
      const form = new FormData()
      form.append('file', file)
      // T44：当前正在浏览某个文件夹时，上传直接落进去
      if (typeof scope === 'number') form.append('folder_id', String(scope))
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
    const refs =
      row.referenced_by > 0
        ? `\n注意：它仍被 ${row.referenced_by} 份设计稿引用，删除后这些稿会缺图（需要先确认）。`
        : ''
    if (!window.confirm(`删除「${row.filename}」？${refs}`)) return
    try {
      await api(`/api/images/${row.id}`, { method: 'DELETE' })
      await load()
      setMessage('已删除。')
    } catch (err) {
      // T47：被引用时后端返回 409 且带可读原因 → 二次确认后用 force 删（明确知情）
      const msg = err instanceof Error ? err.message : '删除失败'
      if (msg.includes('引用') && window.confirm(`${msg}\n\n仍要删除吗？（这些设计稿会缺图）`)) {
        try {
          await api(`/api/images/${row.id}?force=true`, { method: 'DELETE' })
          await load()
          setMessage('已强制删除（引用它的设计稿会缺图）。')
          return
        } catch (forceErr) {
          setMessage(forceErr instanceof Error ? forceErr.message : '删除失败')
          return
        }
      }
      setMessage(msg)
    }
  }

  /** T46b：切换可见性 */
  const changeVisibility = async (row: AssetRow, visibility: string) => {
    try {
      await api(`/api/images/${row.id}/visibility`, {
        method: 'PATCH',
        body: JSON.stringify({ visibility }),
      })
      await load()
      setMessage(`「${row.filename}」已设为：${VISIBILITY_LABEL[visibility] ?? visibility}`)
    } catch (err) {
      setMessage(err instanceof Error ? err.message : '可见性切换失败')
    }
  }

  // ---- T44：文件夹（一层目录）----

  const createFolder = async () => {
    const name = window.prompt('新建文件夹（一层目录，最多 32 字）')
    if (!name?.trim()) return
    try {
      const created = await api<FolderRow>('/api/asset-folders', {
        method: 'POST',
        body: JSON.stringify({ name: name.trim() }),
      })
      await loadFolders()
      setScope(created.id)
      setMessage(`已创建文件夹「${created.name}」。`)
    } catch (err) {
      setMessage(err instanceof Error ? err.message : '新建文件夹失败')
    }
  }

  const renameFolder = async (folder: FolderRow) => {
    const name = window.prompt('重命名文件夹', folder.name)
    if (!name?.trim() || name.trim() === folder.name) return
    try {
      await api(`/api/asset-folders/${folder.id}`, { method: 'PATCH', body: JSON.stringify({ name: name.trim() }) })
      await loadFolders()
      setMessage('已重命名。')
    } catch (err) {
      setMessage(err instanceof Error ? err.message : '重命名失败')
    }
  }

  const removeFolder = async (folder: FolderRow) => {
    const hint = folder.count > 0 ? `\n其中 ${folder.count} 张图片会回到「未分组」（不会被删除）。` : ''
    if (!window.confirm(`删除文件夹「${folder.name}」？${hint}`)) return
    try {
      await api(`/api/asset-folders/${folder.id}`, { method: 'DELETE' })
      if (scope === folder.id) setScope('all')
      await load()
      setMessage('已删除文件夹（里面的图片已回到未分组）。')
    } catch (err) {
      setMessage(err instanceof Error ? err.message : '删除文件夹失败')
    }
  }

  /** 把资产移到某个文件夹（空值 = 未分组） */
  const moveAsset = async (row: AssetRow, value: string) => {
    try {
      await api(`/api/images/${row.id}/folder`, {
        method: 'PATCH',
        body: JSON.stringify({ folder_id: value === '' ? null : Number(value) }),
      })
      await load()
      setMessage(value === '' ? '已移出到「未分组」。' : '已移动到目标文件夹。')
    } catch (err) {
      setMessage(err instanceof Error ? err.message : '移动失败')
    }
  }

  /**
   * 2026-09-16 拖拽排序（资产）：只在**单个作用域内**允许（某个文件夹或未分组）。
   * "全部素材"视图混着各文件夹的资产，排序没有明确语义，所以那里不给拖（见 asset-order-hint）。
   */
  const reorderAssets = async (targetId: number) => {
    if (draggingAssetId === null || draggingAssetId === targetId) return
    if (scope === 'all') return
    const ids = (data?.images ?? []).map((r) => r.id)
    const from = ids.indexOf(draggingAssetId)
    const to = ids.indexOf(targetId)
    if (from < 0 || to < 0) return
    ids.splice(to, 0, ...ids.splice(from, 1))
    setDraggingAssetId(null)
    try {
      await api('/api/images/order', {
        method: 'PATCH',
        body: JSON.stringify({ ids, folder_id: scope === 'none' ? null : scope }),
      })
      await load()
      setMessage('已保存新的排序。')
    } catch (err) {
      setMessage(err instanceof Error ? err.message : '排序失败')
    }
  }

  /** 文件夹自身的拖拽排序（与资产同理，只在侧边栏内部重排） */
  const reorderFolders = async (targetId: number) => {
    if (draggingFolderId === null || draggingFolderId === targetId) return
    const ids = folders.folders.map((f) => f.id)
    const from = ids.indexOf(draggingFolderId)
    const to = ids.indexOf(targetId)
    if (from < 0 || to < 0) return
    ids.splice(to, 0, ...ids.splice(from, 1))
    setDraggingFolderId(null)
    try {
      await api('/api/asset-folders/order', { method: 'PATCH', body: JSON.stringify({ ids }) })
      await loadFolders()
      setMessage('已保存文件夹顺序。')
    } catch (err) {
      setMessage(err instanceof Error ? err.message : '文件夹排序失败')
    }
  }

  /** 复制图片链接：public-link 复制"带凭证的公开链接"，其余复制需要登录的地址。 */
  const copyUrl = async (row: AssetRow) => {
    const target = row.visibility === 'public-link' ? row.public_url : row.url
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${target}`)
      setMessage(
        row.visibility === 'public-link'
          ? '公开链接已复制：任何人打开都能看到这张图。'
          : '链接已复制：对方需登录且能看到引用它的设计稿（或同工作区）才读得到。',
      )
    } catch {
      setMessage(`复制失败，请手动复制：${target}`)
    }
  }

  const used = data?.used_bytes ?? 0
  const count = data?.images.length ?? 0
  /** 文件夹计数是全账号口径（与当前浏览范围无关），所以"全部"能用它显示总数 */
  const totalCount = folders.folders.reduce((sum, f) => sum + f.count, 0) + folders.ungrouped
  const scopeBtnCls = (active: boolean) =>
    `flex w-full items-center justify-between rounded px-2 py-1 text-left text-[13px] ${
      active ? 'bg-primary/10 font-medium text-primary' : 'text-muted-foreground hover:bg-accent'
    }`

  return (
    <div className="mx-auto flex max-w-[1120px] gap-6 px-8 py-8" data-testid="assets-page">
      {/* T44：文件夹栏（一层目录；删除文件夹不删素材） */}
      <aside className="w-48 shrink-0" data-testid="asset-folders">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">文件夹</span>
          <button
            className="rounded border border-border px-1.5 text-xs hover:bg-accent"
            data-testid="folder-create"
            title="新建文件夹"
            onClick={() => void createFolder()}
          >
            ＋
          </button>
        </div>
        <ul className="flex flex-col gap-0.5">
          <li>
            <button className={scopeBtnCls(scope === 'all')} data-testid="folder-all" onClick={() => setScope('all')}>
              <span>全部素材</span>
              <span className="text-[11px] text-muted-foreground" data-testid="folder-count-all">
                {totalCount}
              </span>
            </button>
          </li>
          <li>
            <button className={scopeBtnCls(scope === 'none')} data-testid="folder-none" onClick={() => setScope('none')}>
              <span>未分组</span>
              <span className="text-[11px] text-muted-foreground" data-testid="folder-count-none">
                {folders.ungrouped}
              </span>
            </button>
          </li>
          {folders.folders.map((f) => (
            <li
              key={f.id}
              className="flex items-center gap-0.5"
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => void reorderFolders(f.id)}
            >
              <span
                className="cursor-grab select-none px-0.5 text-[11px] text-muted-foreground"
                data-testid={`folder-grip-${f.id}`}
                title="拖动调整文件夹顺序"
                draggable
                onDragStart={() => setDraggingFolderId(f.id)}
                onDragEnd={() => setDraggingFolderId(null)}
              >
                ⠿
              </span>
              <button
                className={scopeBtnCls(scope === f.id)}
                data-testid={`folder-${f.id}`}
                title={f.name}
                onClick={() => setScope(f.id)}
              >
                <span className="truncate">{f.name}</span>
                <span className="text-[11px] text-muted-foreground" data-testid={`folder-count-${f.id}`}>
                  {f.count}
                </span>
              </button>
              <button
                className="rounded px-1 text-[11px] text-muted-foreground hover:bg-accent"
                data-testid={`folder-rename-${f.id}`}
                title="重命名"
                onClick={() => void renameFolder(f)}
              >
                ✎
              </button>
              <button
                className="rounded px-1 text-[11px] text-muted-foreground hover:text-destructive"
                data-testid={`folder-delete-${f.id}`}
                title="删除文件夹（里面的图片会回到未分组）"
                onClick={() => void removeFolder(f)}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
          进入文件夹后上传的图片会直接放进该文件夹；删除文件夹不会删除图片。
        </p>
        {scope === 'all' ? (
          <p className="mt-2 text-[11px] text-muted-foreground" data-testid="asset-order-hint">
            进入某个文件夹（或「未分组」）后可拖 ⠿ 排序——"全部素材"里混着各文件夹，排序没有明确语义。
          </p>
        ) : (
          <p className="mt-2 text-[11px] text-muted-foreground" data-testid="asset-order-hint">
            拖 ⠿ 调整顺序（仅当前范围）。
          </p>
        )}
      </aside>

      <div className="min-w-0 flex-1">
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
          className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-accent disabled:opacity-50"
          data-testid="asset-upload"
          disabled={busy}
          onClick={() => fileRef.current?.click()}
        >
          {busy ? '上传中…' : '⬆ 上传图片'}
        </button>
        {/* T45：展示方式切换（记住选择，见 lib/assetView.ts） */}
        <div className="ml-auto flex items-center gap-1" data-testid="asset-view-switch">
          {ASSET_VIEWS.map((v) => (
            <button
              key={v}
              className={`rounded border px-2 py-1 text-[11px] ${
                view === v ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:bg-accent'
              }`}
              data-testid={`view-${v}`}
              aria-pressed={view === v}
              title={`展示方式：${ASSET_VIEW_LABEL[v]}`}
              onClick={() => {
                setView(v)
                writeAssetView(v)
              }}
            >
              {ASSET_VIEW_LABEL[v]}
            </button>
          ))}
        </div>
      </div>
      <p className="mb-3 text-xs text-muted-foreground">
        支持 png / jpg / webp / gif，单文件 ≤2MB；导出时图片会内联进工程（不会丢图）。
        <br />
        可见性：<strong>私有</strong> 只有你能主动打开，但被你共享出去的设计稿引用时，协作者也能读到（否则对方缺图）；
        <strong>工作区可见</strong> 给同工作区成员；<strong>公开链接</strong> 任何人都能凭「复制链接」得到的地址查看。
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

      {/* T45：四种展示方式。details 是"文件信息"列表，其余三种共用卡片结构，只改缩略图尺寸与网格密度 */}
      <div data-testid="asset-view" data-view={view}>
        {view === 'details' ? (
          <div className="divide-y divide-border rounded-xl border border-border" data-testid="asset-details">
            {(data?.images ?? []).map((row) => (
              <div
                key={row.id}
                className="flex items-center gap-3 px-3 py-2"
                data-testid={`asset-row-${row.id}`}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => void reorderAssets(row.id)}
              >
                <img src={row.url} alt={row.filename} className="h-9 w-9 shrink-0 rounded object-cover" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1">
                    {scope !== 'all' && (
                      <span
                        className="cursor-grab select-none text-[11px] text-muted-foreground"
                        data-testid={`asset-grip-${row.id}`}
                        title="拖动调整顺序"
                        draggable
                        onDragStart={() => setDraggingAssetId(row.id)}
                        onDragEnd={() => setDraggingAssetId(null)}
                      >
                        ⠿
                      </span>
                    )}
                    <div className="truncate text-[13px] font-medium" title={row.filename}>
                      {row.filename}
                    </div>
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                    <span>{humanSize(row.size)}</span>
                    <span>{row.created_at ? new Date(row.created_at).toLocaleDateString() : ''}</span>
                    <span>{VISIBILITY_LABEL[row.visibility] ?? row.visibility}</span>
                    {row.referenced_by > 0 && (
                      <span data-testid={`asset-refs-${row.id}`}>被 {row.referenced_by} 份稿件引用</span>
                    )}
                  </div>
                </div>
                <div className="w-36 shrink-0">
                  <AssetSelectors
                    row={row}
                    folders={folders.folders}
                    compact
                    onVisibility={(v) => void changeVisibility(row, v)}
                    onFolder={(v) => void moveAsset(row, v)}
                  />
                </div>
                <div className="w-64 shrink-0">
                  <AssetActions
                    row={row}
                    onCopy={() => void copyUrl(row)}
                    onDelete={() => void remove(row)}
                    onUse={() => navigate(`/workspace?asset=${row.id}`)}
                  />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className={GRID_CLASS[view]}>
            {(data?.images ?? []).map((row) => (
              <div
                key={row.id}
                className="overflow-hidden rounded-xl border border-border bg-card"
                data-testid={`asset-card-${row.id}`}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => void reorderAssets(row.id)}
              >
                <div
                  className={`flex items-center justify-center bg-muted/40 p-2 ${
                    view === 'small' ? 'h-16' : view === 'tiles' ? 'h-[88px]' : 'h-[122px]'
                  }`}
                >
                  <img src={row.url} alt={row.filename} className="max-h-full max-w-full object-contain" />
                </div>
                <div className="border-t border-border px-3 py-2">
                  <div className="flex items-center gap-1">
                    {scope !== 'all' && (
                      <span
                        className="cursor-grab select-none text-[11px] text-muted-foreground"
                        data-testid={`asset-grip-${row.id}`}
                        title="拖动调整顺序"
                        draggable
                        onDragStart={() => setDraggingAssetId(row.id)}
                        onDragEnd={() => setDraggingAssetId(null)}
                      >
                        ⠿
                      </span>
                    )}
                    <div className="truncate text-[13px] font-medium" title={row.filename}>
                      {row.filename}
                    </div>
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                    <span>{humanSize(row.size)}</span>
                    <span>{row.created_at ? new Date(row.created_at).toLocaleDateString() : ''}</span>
                    {row.referenced_by > 0 && (
                      <span data-testid={`asset-refs-${row.id}`}>被 {row.referenced_by} 份稿件引用</span>
                    )}
                  </div>
                  <AssetSelectors
                    row={row}
                    folders={folders.folders}
                    compact={view === 'small'}
                    onVisibility={(v) => void changeVisibility(row, v)}
                    onFolder={(v) => void moveAsset(row, v)}
                  />
                  <AssetActions
                    row={row}
                    onCopy={() => void copyUrl(row)}
                    onDelete={() => void remove(row)}
                    onUse={() => navigate(`/workspace?asset=${row.id}`)}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      </div>
    </div>
  )
}
