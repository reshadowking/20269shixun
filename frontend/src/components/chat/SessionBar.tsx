/**
 * 会话栏（缺陷 4）：当前会话 + 侧边会话列表（只读元信息）+ 新建/切换/删除 + 会话快照（4b）。
 * 组件保持无路由依赖（切换/新建由上层导航实现），便于单测。
 */
import { useState } from 'react'

import type { SessionMeta } from '@/lib/sessionApi'
import type { SessionSnapshot } from '@/lib/sessionSnapshots'

interface SessionBarProps {
  sessionKey: string
  sessions: SessionMeta[]
  loading: boolean
  error: string
  onSwitch: (sessionKey: string) => void
  onNew: () => void
  onDelete: (sessionKey: string) => void
  snapshots: SessionSnapshot[]
  onSaveSnapshot: (label: string) => void
  onRestoreSnapshot: (id: string) => void
  onDeleteSnapshot: (id: string) => void
  /** 快照数量上限（提示用） */
  snapshotLimit?: number
}

function fmtTime(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export default function SessionBar({
  sessionKey,
  sessions,
  loading,
  error,
  onSwitch,
  onNew,
  onDelete,
  snapshots,
  onSaveSnapshot,
  onRestoreSnapshot,
  onDeleteSnapshot,
  snapshotLimit = 10,
}: SessionBarProps) {
  const [listOpen, setListOpen] = useState(false)
  const [snapOpen, setSnapOpen] = useState(false)
  const [label, setLabel] = useState('')
  const current = sessions.find((s) => s.session_id === sessionKey)
  const title = current?.title ?? '当前会话'

  return (
    <div className="shrink-0 border-b bg-background px-2 py-1.5 text-xs" data-testid="session-bar">
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-1 text-left"
          data-testid="session-current"
          title={`当前会话：${sessionKey}`}
          onClick={() => {
            setListOpen((v) => !v)
            setSnapOpen(false)
          }}
        >
          <span className="truncate font-medium" data-testid="session-title">
            {title}
          </span>
          <span className="shrink-0 text-[10px] text-muted-foreground" data-testid="session-key">
            {sessionKey}
          </span>
        </button>
        <button
          type="button"
          className="shrink-0 rounded px-1 hover:bg-accent"
          data-testid="session-snapshots-toggle"
          title="会话快照（可回退到任意历史节点）"
          onClick={() => {
            setSnapOpen((v) => !v)
            setListOpen(false)
          }}
        >
          快照
        </button>
        <button
          type="button"
          className="shrink-0 rounded px-1 hover:bg-accent"
          data-testid="session-new"
          title="新建会话（全新空画布）"
          onClick={onNew}
        >
          ＋
        </button>
      </div>

      {listOpen && (
        <ul className="mt-1 max-h-40 overflow-y-auto rounded border" data-testid="session-list">
          {loading && <li className="px-1.5 py-1 text-muted-foreground">加载中…</li>}
          {!loading && sessions.length === 0 && <li className="px-1.5 py-1 text-muted-foreground">暂无会话</li>}
          {sessions.map((s) => (
            <li key={s.session_id} className="flex items-center gap-1 border-b px-1.5 py-1 last:border-b-0">
              <button
                type="button"
                className={`min-w-0 flex-1 truncate text-left ${s.session_id === sessionKey ? 'font-medium text-primary' : ''}`}
                data-testid={`session-item-${s.session_id}`}
                title={s.session_id}
                onClick={() => s.session_id !== sessionKey && onSwitch(s.session_id)}
              >
                {s.title} <span className="text-[10px] text-muted-foreground">{fmtTime(s.updated_at)}</span>
              </button>
              <button
                type="button"
                className="shrink-0 rounded px-1 text-muted-foreground hover:text-destructive"
                data-testid={`session-delete-${s.session_id}`}
                title="删除会话"
                onClick={() => onDelete(s.session_id)}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}

      {snapOpen && (
        <div className="mt-1 rounded border p-1.5" data-testid="session-snapshots">
          <div className="flex items-center gap-1">
            <input
              className="min-w-0 flex-1 rounded border px-1 py-0.5 text-[11px]"
              data-testid="snapshot-label"
              placeholder="快照备注（可选）"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
            <button
              type="button"
              className="shrink-0 rounded border px-1.5 py-0.5 text-[11px] hover:border-primary"
              data-testid="snapshot-save"
              onClick={() => {
                onSaveSnapshot(label)
                setLabel('')
              }}
            >
              保存快照
            </button>
          </div>
          <ul className="mt-1 max-h-32 overflow-y-auto" data-testid="snapshot-list">
            {snapshots.length === 0 && <li className="py-0.5 text-muted-foreground">还没有快照（上限 {snapshotLimit} 条）</li>}
            {snapshots.map((s) => (
              <li key={s.id} className="flex items-center gap-1 py-0.5">
                <span className="min-w-0 flex-1 truncate text-[11px]">
                  {fmtTime(new Date(s.at).toISOString())} · {s.label || '未命名快照'}
                </span>
                <button
                  type="button"
                  className="shrink-0 rounded px-1 text-[11px] text-primary hover:underline"
                  data-testid={`snapshot-restore-${s.id}`}
                  onClick={() => onRestoreSnapshot(s.id)}
                >
                  回退
                </button>
                <button
                  type="button"
                  className="shrink-0 rounded px-1 text-[11px] text-muted-foreground hover:text-destructive"
                  data-testid={`snapshot-delete-${s.id}`}
                  onClick={() => onDeleteSnapshot(s.id)}
                >
                  删
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {error && (
        <p className="mt-1 text-[11px] text-amber-600" data-testid="session-bar-error">
          {error}
        </p>
      )}
    </div>
  )
}
