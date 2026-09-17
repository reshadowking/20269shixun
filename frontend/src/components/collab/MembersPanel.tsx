/**
 * T46a-4：工作区「成员与邀请」面板（挂设置页）。
 *
 * 只做三件事，都是协作能真正跑起来的最小闭环：
 *   ① 列出我参与的工作区及我的角色（默认选我自己的个人工作区）；
 *   ② 成员列表 + 移除（仅 owner；owner 自己不可被移除，后端 422）；
 *   ③ 生成**一次性**邀请链接（editor / viewer），带复制按钮。
 * 没有 owner 权限时按钮直接禁用并说明原因——不让人点了才知道不行。
 *
 * T46a-4：新增 ④ 按用户名直接邀请；并支持 `fixedWorkspaceId`（工作台内的"邀请协作"弹窗
 * 只针对当前稿件的那个工作区，不给切换）。
 */
import { useCallback, useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { api } from '@/lib/api'

type Workspace = { id: number; name: string; owner_id: number; role: string }
type Member = { user_id: number; username: string; role: string }

const ROLE_LABEL: Record<string, string> = {
  owner: '所有者',
  editor: '可编辑',
  viewer: '只读访客',
}

const selectCls = 'h-9 rounded-md border border-input bg-background px-2 text-sm'

export default function MembersPanel({
  fixedWorkspaceId,
  onClose,
}: {
  /** 指定工作区（工作台弹窗用法）：隐藏选择器，只操作这一个 */
  fixedWorkspaceId?: number
  /** 传入则显示关闭按钮（弹窗用法） */
  onClose?: () => void
} = {}) {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [workspaceId, setWorkspaceId] = useState<number | null>(fixedWorkspaceId ?? null)
  const [members, setMembers] = useState<Member[]>([])
  const [inviteRole, setInviteRole] = useState<'editor' | 'viewer'>('editor')
  const [inviteLink, setInviteLink] = useState('')
  const [inviteUsername, setInviteUsername] = useState('')
  const [msg, setMsg] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api<{ workspaces: Workspace[] }>('/api/workspaces')
      .then((r) => {
        setWorkspaces(r.workspaces)
        const mine = r.workspaces.find((w) => w.role === 'owner') ?? r.workspaces[0]
        if (fixedWorkspaceId === undefined && mine) setWorkspaceId(mine.id)
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : '工作区列表加载失败'))
  }, [])

  /**
   * 请求序号（2026-09-17）：面板可以快速切工作区，而成员请求的返回顺序不保证 ——
   * 慢的旧响应会把**上一个工作区**的成员列表贴到当前工作区上。
   * 只有最新一次请求能写状态；过期响应（含其错误）整段丢弃。
   */
  const membersSeq = useRef(0)

  const loadMembers = useCallback((id: number) => {
    const seq = ++membersSeq.current
    setError('')
    api<{ members: Member[] }>(`/api/workspaces/${id}/members`)
      .then((r) => {
        if (seq !== membersSeq.current) return
        setMembers(r.members)
      })
      .catch((err: unknown) => {
        if (seq !== membersSeq.current) return
        setError(err instanceof Error ? err.message : '成员列表加载失败')
      })
  }, [])

  useEffect(() => {
    if (workspaceId !== null) loadMembers(workspaceId)
  }, [workspaceId, loadMembers])

  const current = workspaces.find((w) => w.id === workspaceId) ?? null
  const myRole = current?.role ?? null
  const isOwner = myRole === 'owner'
  /**
   * 2026-09-16 决策：邀请放宽到 editor，但**可邀角色上限是 viewer**（后端同规则）。
   * 这里同步把角色选择锁成 viewer，让"点不动的按钮"变成"看得懂的选择"。
   */
  const canInvite = isOwner || myRole === 'editor'
  useEffect(() => {
    if (myRole && myRole !== 'owner') setInviteRole('viewer')
  }, [myRole])

  const createInvite = async () => {
    if (workspaceId === null) return
    setBusy(true)
    setError('')
    setInviteLink('')
    try {
      const r = await api<{ token: string; role: string; join_path: string }>(
        `/api/workspaces/${workspaceId}/invites`,
        { method: 'POST', body: JSON.stringify({ role: inviteRole }) },
      )
      setInviteLink(`${window.location.origin}${r.join_path}`)
      setMsg(`已生成 ${ROLE_LABEL[r.role] ?? r.role} 邀请链接（一次性，用过即失效）`)
    } catch (err) {
      setError(err instanceof Error ? err.message : '生成邀请失败')
    } finally {
      setBusy(false)
    }
  }

  /** T46a-4：按用户名直接邀请（对方必须已注册；后端 404/409 都带可读原因） */
  const inviteByUsername = async () => {
    if (workspaceId === null || !inviteUsername.trim()) return
    setBusy(true)
    setError('')
    try {
      const r = await api<{ username: string; role: string }>(
        `/api/workspaces/${workspaceId}/invites/by-username`,
        { method: 'POST', body: JSON.stringify({ username: inviteUsername.trim(), role: inviteRole }) },
      )
      setMsg(`已把「${r.username}」加入工作区（${ROLE_LABEL[r.role] ?? r.role}）`)
      setInviteUsername('')
      loadMembers(workspaceId)
    } catch (err) {
      setError(err instanceof Error ? err.message : '邀请失败')
    } finally {
      setBusy(false)
    }
  }

  const copyInvite = async () => {
    try {
      await navigator.clipboard.writeText(inviteLink)
      setMsg('邀请链接已复制')
    } catch {
      setMsg('复制失败，请手动选中链接复制')
    }
  }

  const removeMember = async (member: Member) => {
    if (workspaceId === null) return
    if (!window.confirm(`把 ${member.username} 移出该工作区？对方的访问会立即失效。`)) return
    setBusy(true)
    setError('')
    try {
      await api(`/api/workspaces/${workspaceId}/members/${member.user_id}`, { method: 'DELETE' })
      setMsg(`已移除 ${member.username}`)
      loadMembers(workspaceId)
    } catch (err) {
      setError(err instanceof Error ? err.message : '移除失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-6 w-full max-w-2xl rounded-xl border bg-background p-8 shadow-sm" data-testid="members-panel">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">成员与邀请</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            邀请对方加入你的工作区后，你名下的设计稿对 TA 可见（权限按角色生效）。
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {fixedWorkspaceId === undefined && (
            <select
              className={selectCls}
              data-testid="members-workspace-select"
              value={workspaceId ?? ''}
              onChange={(e) => setWorkspaceId(Number(e.target.value))}
            >
              {workspaces.length === 0 && <option value="">（暂无工作区）</option>}
              {workspaces.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}（{ROLE_LABEL[w.role] ?? w.role}）
                </option>
              ))}
            </select>
          )}
          {onClose && (
            <Button variant="outline" size="sm" className="h-7 text-xs" data-testid="members-close" onClick={onClose}>
              关闭
            </Button>
          )}
        </div>
      </div>

      <div className="mt-4 flex flex-col gap-2">
        <div className="text-xs text-muted-foreground">成员（{members.length}）</div>
        {members.map((m) => (
          <div
            key={m.user_id}
            className="flex items-center justify-between gap-2 rounded-md border bg-muted/30 px-3 py-2 text-sm"
            data-testid={`member-row-${m.username}`}
          >
            <span className="min-w-0 flex-1 truncate">
              {m.username}
              <span className="ml-2 text-xs text-muted-foreground" data-testid={`member-role-${m.username}`}>
                {ROLE_LABEL[m.role] ?? m.role}
              </span>
            </span>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              data-testid={`member-remove-${m.username}`}
              disabled={busy || !isOwner || m.role === 'owner'}
              title={
                !isOwner
                  ? '只有工作区所有者可以移除成员'
                  : m.role === 'owner'
                    ? '不能移除所有者'
                    : '移出该工作区'
              }
              onClick={() => removeMember(m)}
            >
              移除
            </Button>
          </div>
        ))}
      </div>

      <div className="mt-4 flex flex-col gap-2 rounded-md border p-3">
        <div className="text-xs text-muted-foreground">生成邀请链接</div>
        <div className="flex items-center gap-2">
          <select
            className={selectCls}
            data-testid="invite-role"
            value={inviteRole}
            onChange={(e) => setInviteRole(e.target.value as 'editor' | 'viewer')}
          >
            {/* editor 视角下不提供"可编辑"选项：谁能写由 owner 决定 */}
            {isOwner && <option value="editor">可编辑（editor）</option>}
            <option value="viewer">只读访客（viewer）</option>
          </select>
          <Button
            size="sm"
            data-testid="invite-create"
            disabled={busy || !canInvite || workspaceId === null}
            title={canInvite ? undefined : '只有 owner / editor 可以生成邀请'}
            onClick={createInvite}
          >
            生成邀请链接
          </Button>
        </div>
        {myRole === 'editor' && (
          <p className="text-[11px] text-muted-foreground" data-testid="invite-role-cap">
            你是可编辑成员：只能邀请**只读访客**（可写成员的增删由 owner 决定）。
          </p>
        )}
        {myRole === 'viewer' && (
          <p className="text-[11px] text-muted-foreground" data-testid="invite-viewer-note">
            你是只读访客：可以查看成员与角色，但不能邀请或移除成员。顶栏这个入口保留可点，正是为了让你看得到名单。
          </p>
        )}
        {inviteLink && (
          <div className="flex items-center gap-2">
            <input
              className="h-8 flex-1 rounded-md border border-input bg-background px-2 text-xs"
              data-testid="invite-link"
              readOnly
              value={inviteLink}
            />
            <Button variant="outline" size="sm" className="h-8 text-xs" data-testid="invite-copy" onClick={copyInvite}>
              复制
            </Button>
          </div>
        )}
        <p className="text-[11px] text-muted-foreground">
          链接 72 小时内有效、**只能用一次**；对方登录后打开即加入。
        </p>
      </div>

      {/* T46a-4：按用户名直接邀请（省掉发链接那一步；对方需已注册） */}
      <div className="mt-4 flex flex-col gap-2 rounded-md border p-3">
        <div className="text-xs text-muted-foreground">按用户名直接邀请（对方需已注册）</div>
        <div className="flex items-center gap-2">
          <input
            className="h-8 flex-1 rounded-md border border-input bg-background px-2 text-xs"
            data-testid="invite-username"
            value={inviteUsername}
            placeholder="对方登录账号，例如 alice"
            // 无邀请权限时直接禁用：按钮禁用但输入框能打字，会让人以为"打完字就有用"
            disabled={!canInvite}
            onChange={(e) => setInviteUsername(e.target.value)}
          />
          <Button
            size="sm"
            className="h-8 text-xs"
            data-testid="invite-username-submit"
            disabled={busy || !canInvite || workspaceId === null || !inviteUsername.trim()}
            title={canInvite ? undefined : '只有 owner / editor 可以邀请成员'}
            onClick={inviteByUsername}
          >
            直接邀请
          </Button>
        </div>
        <p className="text-[11px] text-muted-foreground">
          角色沿用上方选择（当前：{ROLE_LABEL[inviteRole] ?? inviteRole}）；对方下次登录即可看到你的设计稿。
        </p>
      </div>

      {msg && <p className="mt-3 text-xs text-emerald-600" data-testid="members-msg">{msg}</p>}
      {error && <p className="mt-3 text-xs text-destructive" data-testid="members-error">{error}</p>}
    </div>
  )
}
