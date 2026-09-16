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


def _require_invite_rights(inviter_role: str, target_role: str) -> None:
    """谁能邀请谁（2026-09-16 决策：放宽到 editor，但**可邀角色上限为 viewer**）。

    - owner：可发 editor / viewer；
    - editor：只能发 viewer——"谁能写"始终由 owner 决定，避免 editor 再造 editor 把权限链延长
      （当前没有审计、没有成员变更通知，出事不好收敛）；
    - viewer / 非成员：不能邀请。
    """
    if inviter_role not in ("owner", "editor"):
        raise HTTPException(status_code=403, detail="只有 owner / editor 可以邀请成员")
    if inviter_role == "editor" and target_role != "viewer":
        raise HTTPException(status_code=403, detail="可编辑成员只能邀请只读访客（可写成员的增删由 owner 决定）")


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
    """生成一次性邀请链接（owner 可发 editor/viewer；editor 只能发 viewer）。"""
    me = _owner_id(db, _user)
    member = _member(db, workspace_id, me)
    if member is None:
        raise HTTPException(status_code=404, detail="工作区不存在或无权访问")
    if req.role not in INVITE_ROLES:
        raise HTTPException(status_code=422, detail=f"role 必须是 {'/'.join(INVITE_ROLES)} 之一")
    _require_invite_rights(member.role, req.role)
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


class InviteByNameRequest(BaseModel):
    username: str = Field(min_length=3, max_length=64)
    role: str = Field(default="editor", max_length=16)


@router.post("/api/workspaces/{workspace_id}/invites/by-username")
def invite_by_username(
    workspace_id: int,
    req: InviteByNameRequest,
    db: DbSession = Depends(get_db),
    _user: str = Depends(get_current_user),
):
    """T46a-4 第 3 件：直接按用户名把对方加为成员（省掉"发链接→对方点开"两步）。

    口径：
    - owner 可发 editor / viewer；**editor 只能发 viewer**（与链接邀请同一套规则，见 `_require_invite_rights`）；
    - 对方**必须已注册**（不存在 → 404，提示先注册；不自动建号，避免悄悄给别人开账号）；
    - 已是成员 → 409（不静默改角色，让邀请方自己决策）；
    - 不能邀请自己（422）。
    """
    me = _owner_id(db, _user)
    member = _member(db, workspace_id, me)
    if member is None:
        raise HTTPException(status_code=404, detail="工作区不存在或无权访问")
    if req.role not in INVITE_ROLES:
        raise HTTPException(status_code=422, detail=f"role 必须是 {'/'.join(INVITE_ROLES)} 之一")
    _require_invite_rights(member.role, req.role)

    target = db.execute(select(User).where(User.username == req.username)).scalar_one_or_none()
    if target is None:
        raise HTTPException(status_code=404, detail=f"账号「{req.username}」不存在，请让对方先注册再加入")
    if target.id == me:
        raise HTTPException(status_code=422, detail="你已经是该工作区成员")
    existing = _member(db, workspace_id, target.id)
    if existing is not None:
        raise HTTPException(status_code=409, detail=f"「{target.username}」已是成员（当前角色：{existing.role}）")

    db.add(WorkspaceMember(workspace_id=workspace_id, user_id=target.id, role=req.role))
    db.commit()
    logger.info("%s 直接把 %s 加为工作区 %s 的 %s", _user, target.username, workspace_id, req.role)
    return {"ok": True, "username": target.username, "role": req.role}


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
