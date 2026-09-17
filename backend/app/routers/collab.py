"""T46a-3：协作房间签发与网关鉴权。

- `GET /api/designs/{id}/collab`：成员可见 → 返回**服务端签发的房间名**与我的角色（非成员 404）；
- `POST /api/collab/authorize`：供 WS 鉴权网关调用（内网令牌保护）→ `{ok, role}`；
  **不返回稿件内容**，只回答"这个 username 能不能进这个 room，以什么角色"。
"""
import hmac
import secrets

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session as DbSession

from ..config import get_settings
from ..db import get_db
from ..models import Design
from ..security import get_current_user
from ..services.workspaces import role_for_design
from .sessions import _owner_id

router = APIRouter(tags=["collab"])

@router.get("/api/designs/{design_id}/collab")
def collab_room(design_id: int, db: DbSession = Depends(get_db), _user: str = Depends(get_current_user)):
    """签发（或返回已存在的）协作房间名 + 我的角色。"""
    me = _owner_id(db, _user)
    design = db.get(Design, design_id)
    if design is None:
        raise HTTPException(status_code=404, detail="设计稿不存在或无权访问")
    role = role_for_design(db, design, me)
    if role is None:
        raise HTTPException(status_code=404, detail="设计稿不存在或无权访问")
    if not design.collab_room:
        design.collab_room = secrets.token_urlsafe(16)
        db.commit()
        db.refresh(design)
    # T46a-4：工作台内的"邀请协作"入口需要知道这份稿件属于哪个工作区
    workspace_id = design.workspace_id
    if workspace_id is None:
        from ..services.workspaces import personal_workspace_of

        ws = personal_workspace_of(db, design.owner_id)
        workspace_id = ws.id if ws else None
    return {
        "room": design.collab_room,
        "role": role,
        "can_edit": role in ("owner", "editor"),
        "design_id": design.id,
        "workspace_id": workspace_id,
    }


class AuthorizeRequest(BaseModel):
    room: str = Field(min_length=8, max_length=64)
    username: str = Field(min_length=1, max_length=64)


@router.post("/api/collab/authorize")
def authorize(
    req: AuthorizeRequest,
    x_internal_token: str | None = Header(default=None, alias="X-Internal-Token"),
    db: DbSession = Depends(get_db),
):
    """网关侧调用：房间 + 用户名 → 能否进入、以什么角色（只读与否由网关按角色执行）。"""
    expected = get_settings().collab_internal_token
    if not expected:
        raise HTTPException(status_code=503, detail="未配置 COLLAB_INTERNAL_TOKEN，协作鉴权未启用")
    # 常量时间比较：这是**凭证**比对（与 images.py 的公开链接凭证同一口径），
    # 避免逐字符短路比较泄漏前缀（内网端口也不该例外）。
    if not hmac.compare_digest(x_internal_token or "", expected):
        raise HTTPException(status_code=401, detail="内网令牌无效")

    from ..models import User

    user = db.execute(select(User).where(User.username == req.username)).scalar_one_or_none()
    design = db.execute(select(Design).where(Design.collab_room == req.room)).scalars().first()
    # 兼容当前前端派生出的旧房间名（`design-<id>`）：网关不必等前端切到签名房间名就能先上线
    if design is None and req.room.startswith("design-") and req.room[7:].isdigit():
        design = db.get(Design, int(req.room[7:]))
    if user is None:
        return {"ok": False, "role": None}
    if design is None:
        # 房间不对应任何稿件 = 草稿/共享链接类房间：**登录即可协作**（没有成员表可查，也没有稿件数据可泄漏）。
        #
        # 2026-09-16 收紧：这类房间原来走**直连** y-websocket（完全没鉴权），只要那个端口对外，
        # 谁都能连上写。现在一律过网关、要求合法 JWT，房间名当共享凭证。
        # 不按前缀（`session-` 等）限制：前缀挡不住"猜房间名"，却会挡住 E2E 的 `?room=e2e-*`。
        # 真正重要的那条在下面：**房间对应到稿件时必须过成员校验**。
        return {"ok": True, "role": "editor"}
    role = role_for_design(db, design, user.id)
    return {"ok": role is not None, "role": role}
