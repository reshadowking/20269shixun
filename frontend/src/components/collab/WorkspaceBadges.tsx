/**
 * 稿件卡片上的「所属工作区 + 我的角色」徽标（T46a 验收补的缺口）。
 *
 * 为什么要它：稿件可以被移进别人的工作区、也可能被别人共享给我。
 * 卡片如果不标工作区与角色，用户分不清"这是我自己的"还是"别人共享的、我能不能改"，
 * viewer 更是完全看不出自己只读。
 */
const ROLE_LABEL: Record<string, string> = {
  owner: '所有者',
  editor: '可编辑',
  viewer: '只读',
}

const ROLE_CLASS: Record<string, string> = {
  owner: 'border-border text-muted-foreground',
  editor: 'border-primary/40 text-primary',
  viewer: 'border-amber-500/60 bg-amber-500/10 text-amber-600',
}

export default function WorkspaceBadges({
  workspaceName,
  role,
  sharedBy,
  testIdPrefix,
}: {
  workspaceName?: string | null
  role?: string | null
  /** 非我创建的稿件：显示"由 X 共享"（协作者一多，光看工作区名分不清来源） */
  sharedBy?: string | null
  /** 生成 `${prefix}-workspace` / `${prefix}-role` 两个 testid */
  testIdPrefix: string
}) {
  if (!workspaceName && !role && !sharedBy) return null
  return (
    <div className="mt-0.5 flex flex-wrap items-center gap-1 text-[10px]">
      {workspaceName && (
        <span
          className="max-w-[62%] truncate rounded border border-border px-1 text-muted-foreground"
          data-testid={`${testIdPrefix}-workspace`}
          title={`所属工作区：${workspaceName}`}
        >
          {workspaceName}
        </span>
      )}
      {role && (
        <span
          className={`shrink-0 rounded border px-1 ${ROLE_CLASS[role] ?? 'border-border text-muted-foreground'}`}
          data-testid={`${testIdPrefix}-role`}
          title={role === 'viewer' ? '只读：能看不能改（需要 owner / editor 权限）' : undefined}
        >
          {ROLE_LABEL[role] ?? role}
        </span>
      )}
      {sharedBy && (
        <span
          className="max-w-full truncate rounded border border-dashed border-border px-1 text-muted-foreground"
          data-testid={`${testIdPrefix}-shared-by`}
          title={`这份稿件由 ${sharedBy} 创建，你通过工作区协作获得访问`}
        >
          由 {sharedBy} 共享
        </span>
      )}
    </div>
  )
}
