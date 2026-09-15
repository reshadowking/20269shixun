"""T46a：工作区 / 成员 / 邀请接口（协作与权限的实际入口）。

权限模型（沿用 T46a 卡）：
- 角色三档：owner / editor / viewer；viewer 只读（写路径由各接口自行拒绝）；
- 非成员访问工作区或稿件一律 **404**（不泄漏存在性）；
- 邀请一次性：用过即失效；过期 404；已是成员时加入为**幂等**（不降级）。
"""
import logging
import secrets
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session as DbSession

from ..db import get_db
from ..models import User, Workspace, WorkspaceInvite, WorkspaceMember
from ..security import get_current_user
from .sessions import _owner_id

logger = logging.getLogger(__name__)
router = APIRouter(tags=["workspaces"])

INVITE_ROLES = ("editor", "viewer")


def _member(db: DbSession, workspace_id: int, user_id: int) -> WorkspaceMember | None:
    return db.execute(
        select(WorkspaceMember).where(
            WorkspaceMember.workspace_id == workspace_id, WorkspaceMember.user_id == user_id
        )
    ).scalar_one_or_none()


@router.get("/api/workspaces")
def list_workspaces(db: DbSession = Depends(get_db), _user: str = Depends(get_current_user)):
    """我参与的工作区 + 我的角色（owner 排前）。"""
    me = _owner_id(db, _user)
    rows = db.execute(select(WorkspaceMember, Workspace).join(Workspace, Workspace.id == WorkspaceMember.workspace_id).where(WorkspaceMember.user_id == me)).all()
    items = [
        {"id": ws.id, "name": ws.name, "owner_id": ws.owner_id, "role": member.role}
        for member, ws in rows
    ]
    items.sort(key=lambda x: (x["role"] != "owner", x["id"]))
    return {"workspaces": items}


class InviteRequest(BaseModel):
    role: str = Field(default="editor", max_length=16)
    expires_in_hours: int = Field(default=72, ge=1, le=24 * 30)


@router.post("/api/workspaces/{workspace_id}/invites")
def create_invite(
    workspace_id: int, req: InviteRequest, db: DbSession = Depends(get_db), _user: str = Depends(get_current_user)
):
    """生成一次性邀请链接（仅 owner）。"""
    me = _owner_id(db, _user)
    member = _member(db, workspace_id, me)
    if member is None:
        raise HTTPException(status_code=404, detail="工作区不存在或无权访问")
    if member.role != "owner":
        raise HTTPException(status_code=403, detail="只有 owner 可以生成邀请")
    if req.role not in INVITE_ROLES:
        raise HTTPException(status_code=422, detail=f"role 必须是 {'/'.join(INVITE_ROLES)} 之一")
    token = secrets.token_urlsafe(24)
    db.add(
        WorkspaceInvite(
            token=token,
            workspace_id=workspace_id,
            role=req.role,
            created_by=me,
            expires_at=datetime.now(UTC) + timedelta(hours=req.expires_in_hours),
        )
    )
    db.commit()
    return {"token": token, "role": req.role, "join_path": f"/join?token={token}"}


class JoinRequest(BaseModel):
    token: str = Field(min_length=8, max_length=64)


@router.post("/api/workspaces/join")
def join_workspace(req: JoinRequest, db: DbSession = Depends(get_db), _user: str = Depends(get_current_user)):
    """用邀请 token 加入工作区（一次性；已是成员则幂等返回，不降级角色）。"""
    me = _owner_id(db, _user)
    invite = db.get(WorkspaceInvite, req.token)
    if invite is None or invite.used_by is not None:
        raise HTTPException(status_code=404, detail="邀请链接无效或已被使用")
    # SQLite 会丢掉时区信息（返回 naive datetime），比较前统一补上 UTC，避免 naive/aware 混用报错
    expires = invite.expires_at
    if expires is not None:
        if expires.tzinfo is None:
            expires = expires.replace(tzinfo=UTC)
        if expires < datetime.now(UTC):
            raise HTTPException(status_code=404, detail="邀请链接已过期")

    existing = _member(db, invite.workspace_id, me)
    if existing is None:
        db.add(WorkspaceMember(workspace_id=invite.workspace_id, user_id=me, role=invite.role))
    invite.used_by = me
    db.commit()
    ws = db.get(Workspace, invite.workspace_id)
    logger.info("用户 %s 通过邀请加入工作区 %s（role=%s）", _user, invite.workspace_id, existing.role if existing else invite.role)
    return {"workspace_id": invite.workspace_id, "name": ws.name if ws else "", "role": existing.role if existing else invite.role}


@router.get("/api/workspaces/{workspace_id}/members")
def list_members(workspace_id: int, db: DbSession = Depends(get_db), _user: str = Depends(get_current_user)):
    """成员列表（成员可见）。"""
    me = _owner_id(db, _user)
    if _member(db, workspace_id, me) is None:
        raise HTTPException(status_code=404, detail="工作区不存在或无权访问")
    rows = db.execute(
        select(WorkspaceMember, User).join(User, User.id == WorkspaceMember.user_id).where(
            WorkspaceMember.workspace_id == workspace_id
        )
    ).all()
    return {
        "members": [
            {"user_id": m.user_id, "username": u.username, "role": m.role} for m, u in rows
        ]
    }


@router.delete("/api/workspaces/{workspace_id}/members/{user_id}")
def remove_member(
    workspace_id: int, user_id: int, db: DbSession = Depends(get_db), _user: str = Depends(get_current_user)
):
    """移除成员（仅 owner）；也允许自己退出（自己不是 owner 时）。"""
    me = _owner_id(db, _user)
    my = _member(db, workspace_id, me)
    if my is None:
        raise HTTPException(status_code=404, detail="工作区不存在或无权访问")
    target = _member(db, workspace_id, user_id)
    if target is None:
        raise HTTPException(status_code=404, detail="该用户不是成员")
    if target.role == "owner":
        raise HTTPException(status_code=422, detail="不能移除 owner（工作区创建人）")
    if my.role != "owner" and user_id != me:
        raise HTTPException(status_code=403, detail="只有 owner 可以移除其他成员")
    db.delete(target)
    db.commit()
    return {"ok": True}
