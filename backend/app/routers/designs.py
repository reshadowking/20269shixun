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
    """当前用户的设计列表（不含 design_json 全文，轻量元数据）。

    缺陷 2：新增可选 limit/offset 分页参数（缺省不传 = 返回全部，既有调用方行为不变）；
    响应新增 total（当前用户设计总数），既有字段不变。排序按 updated_at 倒序，id 倒序作稳定分页的次级键。
    T36：`with_preview=true` 时额外返回 `design`（解析 design_json）——首页/我的项目用它渲染缩略图；
    缺省 false，既有调用方的响应形状逐字不变。
    """
    owner = _owner_id(db, _user)
    total = db.execute(
        select(func.count()).select_from(Design).where(Design.owner_id == owner)
    ).scalar_one()
    stmt = (
        select(Design)
        .where(Design.owner_id == owner)
        .order_by(Design.updated_at.desc(), Design.id.desc())
        .offset(offset)
    )
    if limit is not None:
        stmt = stmt.limit(limit)
    designs = db.execute(stmt).scalars().all()
    rows = []
    for d in designs:
        meta = _design_meta(d)
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
    for attempt in (1, 2):
        design = Design(
            name=req.name,
            owner_id=owner_id,
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
        design = _own_design(db, design_id, _user)
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
    design = _own_design(db, design_id, _user)
    db.execute(Version.__table__.delete().where(Version.design_id == design_id))
    db.delete(design)
    db.commit()
    return {"ok": True}


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
        design = _own_design(db, design_id, _user)
        _save_version(db, design, note=req.note)
        try:
            db.commit()
            return {"ok": True}
        except IntegrityError:
            db.rollback()
            if attempt == 2:
                raise HTTPException(status_code=500, detail="保存失败：版本号并发冲突，请重试") from None
            logger.warning("手动版本冲突，整体重试（design_id=%s attempt=%s）", design_id, attempt)
