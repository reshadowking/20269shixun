"""T46a：工作区与成员（协作与权限的地基）。

不变量（每条都有测试）：
- 每个用户至少有一个**个人工作区**（owner = 自己）；
- 老数据（designs/images 的 workspace_id 为空）**幂等**归入创建人的个人工作区；
- 角色三档：owner / editor / viewer（viewer 只读——写路径由接口层拒绝）。
"""
from sqlalchemy import select
from sqlalchemy.orm import Session as DbSession

from ..models import Design, Image, Workspace, WorkspaceMember

ROLES = ("owner", "editor", "viewer")
WRITABLE_ROLES = ("owner", "editor")


def personal_workspace_of(db: DbSession, user_id: int) -> Workspace | None:
    """我作为 owner 的个人工作区（按 id 升序取第一个）。"""
    return db.execute(
        select(Workspace).where(Workspace.owner_id == user_id).order_by(Workspace.id.asc())
    ).scalars().first()


def create_personal_workspace(db: DbSession, user_id: int, username: str) -> Workspace:
    """为用户建个人工作区并加入 owner 成员（幂等：已存在则直接返回）。"""
    existing = personal_workspace_of(db, user_id)
    if existing is not None:
        return existing
    ws = Workspace(name=f"{username} 的工作区", owner_id=user_id)
    db.add(ws)
    db.flush()
    db.add(WorkspaceMember(workspace_id=ws.id, user_id=user_id, role="owner"))
    db.commit()
    db.refresh(ws)
    return ws


def role_of(db: DbSession, workspace_id: int, user_id: int) -> str | None:
    row = db.execute(
        select(WorkspaceMember).where(
            WorkspaceMember.workspace_id == workspace_id, WorkspaceMember.user_id == user_id
        )
    ).scalar_one_or_none()
    return row.role if row else None


def ensure_personal_workspaces(db: DbSession) -> int:
    """启动/迁移用：给每个用户补齐个人工作区，并把"无归属"的老数据迁进去。

    幂等——重复执行不会新建重复工作区，也不会重复迁移（只处理 workspace_id IS NULL 的行）。
    返回本次迁移的设计稿数（供日志）。
    """
    from ..models import User

    users = db.execute(select(User)).scalars().all()
    migrated = 0
    for user in users:
        ws = create_personal_workspace(db, user.id, user.username)
        rows = db.execute(
            select(Design).where(Design.owner_id == user.id, Design.workspace_id.is_(None))
        ).scalars().all()
        for row in rows:
            row.workspace_id = ws.id
            migrated += 1
        images = db.execute(
            select(Image).where(Image.owner_id == user.id, Image.workspace_id.is_(None))
        ).scalars().all()
        for image in images:
            image.workspace_id = ws.id
    db.commit()
    return migrated
