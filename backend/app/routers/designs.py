"""设计稿存取接口（缺陷 5/8/16/17：保存/打开/历史版本）。

- 设计存 designs 表（design_json 全文）；保存时自动写入 versions（保留最近 30 版）
- 所有操作按当前登录用户隔离（owner）
- 鉴权：全部接口需要 Bearer token（get_current_user）
"""
import json
import logging

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from ..db import get_db
from ..design.validator import validate_design_safe
from ..models import Design, User, Version
from ..security import get_current_user

logger = logging.getLogger(__name__)
router = APIRouter(tags=["designs"])

MAX_VERSIONS = 30
# 入库前体积上限（P0-3 存储边界防线；schema 单字段已限 5000 字符/500 子节点，此为总量兜底）
MAX_DESIGN_JSON_BYTES = 2_000_000


def _validate_design_payload(design: dict) -> None:
    """入库前校验（Schema 唯一源铁律的存储边界执行）：结构非法或超大体 → 422。

    生成链路已过校验，但画布手编/未来外部写入可能绕过，必须在落库前拦截。
    """
    if len(json.dumps(design, ensure_ascii=False)) > MAX_DESIGN_JSON_BYTES:
        raise HTTPException(status_code=422, detail="设计稿过大（超过 2MB），无法保存")
    ok, errors = validate_design_safe(design)
    if not ok:
        raise HTTPException(status_code=422, detail=f"设计稿不符合 DesignNode Schema：{'；'.join(errors[:5])}")


def _owner_id(db, username: str) -> int:
    user = db.execute(select(User).where(User.username == username)).scalar_one_or_none()
    if user is None:
        # 403 而非 401：token 本身合法，只是库里没有该用户。用 401 会触发前端的
        # "清凭证 + 跳登录"逻辑，把一次数据异常放大成整站掉线（见排查报告 P1-2）
        raise HTTPException(status_code=403, detail="账号不存在，请重新登录")
    return user.id


def _own_design(db, design_id: int, username: str) -> Design:
    design = db.get(Design, design_id)
    if design is None:
        raise HTTPException(status_code=404, detail="设计稿不存在或无权访问")
    # T46a：可见性从"我是拥有者"改为"我是该稿所属工作区的成员"（无归属的老数据按创建人兜底）
    from ..services.workspaces import role_of

    me = _owner_id(db, username)
    if design.workspace_id is None:
        # 兼容期：稿件还没归属工作区时按"创建人"兜底——但创建人的**个人工作区成员**同样可见，
        # 否则刚注册的第二个账号即便被邀请也读不到新稿（等启动迁移补上 workspace_id 后走上面那条分支）
        from ..services.workspaces import personal_workspace_of

        ws = personal_workspace_of(db, design.owner_id)
        if design.owner_id != me and (ws is None or role_of(db, ws.id, me) is None):
            raise HTTPException(status_code=404, detail="设计稿不存在或无权访问")
        return design
    if role_of(db, design.workspace_id, me) is None:
        raise HTTPException(status_code=404, detail="设计稿不存在或无权访问")
    return design


def _writable_design(db, design_id: int, username: str) -> Design:
    """写接口专用（保存 / 写版本 / 删除）：viewer 一律 403。

    T46a-3e：协作网关只挡住了 Yjs 实时写入；**DB 保存是另一条写入口**——
    只读访客若仍能 PUT，就等于"前端看着只读、接口其实能改"。这里按角色拦死。
    """
    from ..services.workspaces import WRITABLE_ROLES, role_for_design

    design = _own_design(db, design_id, username)
    if role_for_design(db, design, _owner_id(db, username)) not in WRITABLE_ROLES:
        raise HTTPException(status_code=403, detail="只读访客：无权修改该设计稿（需要 owner/editor 权限）")
    return design


def _save_version(db, design: Design, note: str = "") -> None:
    """保存一个版本（自动编号，清理超出上限的旧版本）。"""
    latest = db.execute(
        select(Version).where(Version.design_id == design.id).order_by(Version.version_no.desc()).limit(1)
    ).scalar_one_or_none()
    version_no = (latest.version_no if latest else 0) + 1
    db.add(Version(design_id=design.id, version_no=version_no, design_json=design.design_json, note=note, operator=""))
    # 清理超过上限的旧版本
    old = db.execute(
        select(Version)
        .where(Version.design_id == design.id)
        .order_by(Version.version_no.asc())
        .offset(MAX_VERSIONS)
    ).scalars().all()
    for v in old:
        db.delete(v)


class DesignCreate(BaseModel):
    name: str = Field(default="未命名设计稿", max_length=200)
    design: dict


class DesignUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=200)
    design: dict | None = None


class VersionNote(BaseModel):
    note: str = Field(default="", max_length=200)


def _design_meta(design: Design) -> dict:
    try:
        tree = json.loads(design.design_json)
        node_count = 0

        def count(n: dict) -> None:
            nonlocal node_count
            node_count += 1
            for c in n.get("children") or []:
                count(c)

        count(tree)
        size = tree.get("style") or {}
        width = size.get("width") if isinstance(size.get("width"), (int, float)) else 0
        height = size.get("height") if isinstance(size.get("height"), (int, float)) else 0
    except (json.JSONDecodeError, AttributeError):
        node_count = 0
        width = height = 0
    return {
        "id": design.id,
        "name": design.name,
        # T46a-4：让前端能显示/排除"当前工作区"（移动稿件时不能把自己移到自己）
        "workspace_id": design.workspace_id,
        "updated_at": design.updated_at.isoformat() if design.updated_at else None,
        "created_at": design.created_at.isoformat() if design.created_at else None,
        "node_count": node_count,
        "width": width,
        "height": height,
    }


@router.get("/api/designs")
def list_designs(
    limit: int | None = Query(default=None, ge=1, le=200, description="返回条数上限；缺省返回全部"),
    offset: int = Query(default=0, ge=0, description="跳过的条数"),
    with_preview: bool = Query(default=False, description="T36：为列表项附带设计树，用于缩略图预览"),
    _user: str = Depends(get_current_user),
    db=Depends(get_db),
):
    """**我能访问的**稿件列表（不含 design_json 全文，轻量元数据）。

    缺陷 2：新增可选 limit/offset 分页参数（缺省不传 = 返回全部，既有调用方行为不变）；
    响应新增 total（当前用户设计总数），既有字段不变。排序按 updated_at 倒序，id 倒序作稳定分页的次级键。
    T36：`with_preview=true` 时额外返回 `design`（解析 design_json）——首页/我的项目用它渲染缩略图；
    缺省 false，既有调用方的响应形状逐字不变。

    2026-09-16（验收发现的缺口）：此前只按 `owner_id == 我` 过滤，于是"被移进我工作区的稿件"
    权限上能看到、界面上却**发现不了**（我的项目显示 0 份），邀请流程在 UI 上等于断的。
    现在改为"**我所在工作区的稿件** ∪ 我创建的稿件"，并逐行带上 `workspace_name` 与 `my_role`，
    前端据此显示工作区徽标与角色（viewer 标只读）。
    """
    owner = _owner_id(db, _user)
    from sqlalchemy import or_

    from ..models import Workspace, WorkspaceMember

    memberships = {
        row.workspace_id: row.role
        for row in db.execute(
            select(WorkspaceMember.workspace_id, WorkspaceMember.role).where(WorkspaceMember.user_id == owner)
        )
    }
    # 老数据（workspace_id 为空）仍按"创建人"兜底；启动迁移会把它们归入个人工作区，这里只是双保险
    conds = [Design.owner_id == owner]
    if memberships:
        conds.append(Design.workspace_id.in_(list(memberships)))
    scope = or_(*conds)

    total = db.execute(select(func.count()).select_from(Design).where(scope)).scalar_one()
    stmt = (
        select(Design)
        .where(scope)
        .order_by(Design.updated_at.desc(), Design.id.desc())
        .offset(offset)
    )
    if limit is not None:
        stmt = stmt.limit(limit)
    designs = db.execute(stmt).scalars().all()
    page_ws_ids = {d.workspace_id for d in designs if d.workspace_id is not None}
    ws_names = (
        dict(db.execute(select(Workspace.id, Workspace.name).where(Workspace.id.in_(page_ws_ids))).all())
        if page_ws_ids
        else {}
    )
    # 2026-09-16：卡片要能说清"谁共享给我的"——只标工作区名与角色还不够（协作者一多就分不清来源）
    owner_ids = {d.owner_id for d in designs if d.owner_id}
    owner_names = (
        dict(db.execute(select(User.id, User.username).where(User.id.in_(owner_ids))).all()) if owner_ids else {}
    )
    rows = []
    for d in designs:
        meta = _design_meta(d)
        meta["workspace_name"] = ws_names.get(d.workspace_id) if d.workspace_id else None
        meta["my_role"] = memberships.get(d.workspace_id) if d.workspace_id else ("owner" if d.owner_id == owner else None)
        meta["owner_name"] = owner_names.get(d.owner_id)
        meta["is_mine"] = d.owner_id == owner
        if with_preview:
            try:
                meta["design"] = json.loads(d.design_json or "{}")
            except json.JSONDecodeError:
                meta["design"] = {}
        rows.append(meta)
    return {"designs": rows, "total": total}


@router.post("/api/designs")
def create_design(req: DesignCreate, _user: str = Depends(get_current_user), db=Depends(get_db)):
    """新建设计（保存当前树并自动存 v1 版本）；入库前过 DesignNode Schema 校验。

    P0-5：并发写版本撞号（唯一约束）时整体重试一次——rollback 会连同 design 写入一起回滚，
    必须重跑整个创建流程而非只重写版本号。
    """
    _validate_design_payload(req.design)
    owner_id = _owner_id(db, _user)
    # T46a-4：新稿件直接归属创建人的个人工作区（此前 workspace_id 为空，只靠"创建人兜底"判定可见性）
    from ..services.workspaces import create_personal_workspace, personal_workspace_of

    workspace = personal_workspace_of(db, owner_id) or create_personal_workspace(db, owner_id, _user)
    for attempt in (1, 2):
        design = Design(
            name=req.name,
            owner_id=owner_id,
            workspace_id=workspace.id,
            design_json=json.dumps(req.design, ensure_ascii=False),
        )
        db.add(design)
        db.flush()
        _save_version(db, design)
        try:
            db.commit()
            return _design_meta(design)
        except IntegrityError:
            db.rollback()
            if attempt == 2:
                raise HTTPException(status_code=500, detail="保存失败：版本号并发冲突，请重试") from None
            logger.warning("创建设计版本号冲突，整体重试（attempt=%s）", attempt)


@router.get("/api/designs/{design_id}")
def get_design(design_id: int, _user: str = Depends(get_current_user), db=Depends(get_db)):
    """打开设计（返回完整 design_json）。"""
    design = _own_design(db, design_id, _user)
    meta = _design_meta(design)
    try:
        meta["design"] = json.loads(design.design_json)
    except json.JSONDecodeError:
        raise HTTPException(status_code=500, detail="设计数据损坏") from None
    return meta


@router.put("/api/designs/{design_id}")
def update_design(design_id: int, req: DesignUpdate, _user: str = Depends(get_current_user), db=Depends(get_db)):
    """保存设计（更新 JSON，自动留版本）。

    P0-5：并发写版本撞号（唯一约束）时整体重试一次——rollback 会回滚 design_json 更新，
    必须重跑"重查设计 → 应用变更 → 写版本"整个流程，避免在旧数据上重复写版本。
    """
    for attempt in (1, 2):
        design = _writable_design(db, design_id, _user)
        if req.name is not None:
            design.name = req.name
        if req.design is not None:
            _validate_design_payload(req.design)
            design.design_json = json.dumps(req.design, ensure_ascii=False)
            _save_version(db, design)
        try:
            db.commit()
            return _design_meta(design)
        except IntegrityError:
            db.rollback()
            if attempt == 2:
                raise HTTPException(status_code=500, detail="保存失败：版本号并发冲突，请重试") from None
            logger.warning("更新设计版本号冲突，整体重试（design_id=%s attempt=%s）", design_id, attempt)


@router.delete("/api/designs/{design_id}")
def delete_design(design_id: int, _user: str = Depends(get_current_user), db=Depends(get_db)):
    """删除设计（连带历史版本）。"""
    design = _writable_design(db, design_id, _user)
    db.execute(Version.__table__.delete().where(Version.design_id == design_id))
    db.delete(design)
    db.commit()
    return {"ok": True}


class MoveRequest(BaseModel):
    workspace_id: int = Field(ge=1)


@router.post("/api/designs/{design_id}/move")
def move_design(
    design_id: int, req: MoveRequest, _user: str = Depends(get_current_user), db=Depends(get_db)
):
    """T46a-4：把稿件移到另一个工作区。

    两条权限都要满足（缺一不可）：
    - 对**原**位置有写权限（viewer 403）；
    - 对**目标**工作区有写权限（非成员 404 不泄露存在性、成员但 viewer 403）。
    """
    from ..services.workspaces import WRITABLE_ROLES, role_for_design, role_of

    design = _own_design(db, design_id, _user)
    me = _owner_id(db, _user)
    if role_for_design(db, design, me) not in WRITABLE_ROLES:
        raise HTTPException(status_code=403, detail="只读访客：无权移动该设计稿（需要 owner/editor 权限）")
    target_role = role_of(db, req.workspace_id, me)
    if target_role is None:
        raise HTTPException(status_code=404, detail="目标工作区不存在或无权访问")
    if target_role not in WRITABLE_ROLES:
        raise HTTPException(status_code=403, detail="只读成员：无权把稿件移入该工作区")
    design.workspace_id = req.workspace_id
    db.commit()
    db.refresh(design)
    return _design_meta(design)


@router.get("/api/designs/{design_id}/versions")
def list_versions(design_id: int, _user: str = Depends(get_current_user), db=Depends(get_db)):
    """设计的历史版本列表（含完整 JSON 供恢复预览）。"""
    _own_design(db, design_id, _user)
    versions = db.execute(
        select(Version).where(Version.design_id == design_id).order_by(Version.version_no.desc()).limit(MAX_VERSIONS)
    ).scalars().all()
    result = []
    for v in versions:
        try:
            tree = json.loads(v.design_json)
        except json.JSONDecodeError:
            tree = {}
        result.append({
            "id": v.id,
            "version_no": v.version_no,
            "note": v.note,
            "created_at": v.created_at.isoformat() if v.created_at else None,
            "design": tree,
        })
    return {"versions": result}


@router.post("/api/designs/{design_id}/versions")
def save_version(design_id: int, req: VersionNote, _user: str = Depends(get_current_user), db=Depends(get_db)):
    """手动保存当前设计为历史版本（带备注）。P0-5：并发撞号整体重试一次。"""
    for attempt in (1, 2):
        design = _writable_design(db, design_id, _user)
        _save_version(db, design, note=req.note)
        try:
            db.commit()
            return {"ok": True}
        except IntegrityError:
            db.rollback()
            if attempt == 2:
                raise HTTPException(status_code=500, detail="保存失败：版本号并发冲突，请重试") from None
            logger.warning("手动版本冲突，整体重试（design_id=%s attempt=%s）", design_id, attempt)
