"""会话接口（缺陷 4）：sessionId → 会话数据 的映射，服务端强制 owner 与跨会话校验。

- 全部端点要求 Bearer token；他人会话一律 404（不泄漏存在性）。
- 请求体若自带 session_id 且与路径不一致 → 422「跨会话写入被拒绝」（绕过 UI 也无法串写）。
- 列表端点只返回元信息（session_id/title/design_id/时间），不返回消息与 Agent 状态。
"""
import logging

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session as DbSession

from ..db import get_db
from ..models import ChatSession, Design
from ..security import get_current_user
from ..services import sessions as sessions_service
from ..services.beautify import apply_locked_edit
from ..services.sessions import SessionValidationError

logger = logging.getLogger(__name__)
router = APIRouter(tags=["sessions"])


def _owner_id(db: DbSession, username: str) -> int:
    user_id = sessions_service.owner_id_of(db, username)
    if user_id is None:
        # 403 而非 401：token 本身合法，只是库里没有该用户。用 401 会触发前端的
        # "清凭证 + 跳登录"逻辑，把一次数据异常放大成整站掉线（见排查报告 P1-2）
        raise HTTPException(status_code=403, detail="账号不存在，请重新登录")
    return user_id


def _own_session(db: DbSession, username: str, session_key: str) -> ChatSession:
    session = sessions_service.get_owned_session(db, _owner_id(db, username), session_key)
    if session is None:
        raise HTTPException(status_code=404, detail="会话不存在或无权访问")
    return session


def _assert_no_cross_session(path_key: str, body_key: str | None) -> None:
    """路径与请求体声明的会话必须一致：防"用 B 的 id 携带 A 的上下文"写入。"""
    if body_key is not None and body_key != path_key:
        raise HTTPException(status_code=422, detail=f"跨会话写入被拒绝：路径为 {path_key}，请求体声明 {body_key}")


class SessionCreate(BaseModel):
    session_key: str = Field(min_length=3, max_length=64)
    title: str | None = Field(default=None, max_length=200)
    design_id: int | None = None


class SessionPatch(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    # 缺陷 4：会话 ↔ 已保存设计绑定（首次保存为正式设计后调用；不传表示不改）
    design_id: int | None = None


class MessageItem(BaseModel):
    role: str = Field(min_length=1, max_length=16)
    text: str = Field(min_length=1, max_length=8000)


class MessageAppend(BaseModel):
    # 可选声明：仅用于跨会话校验（与路径不一致即拒绝）
    session_id: str | None = None
    messages: list[MessageItem] = Field(default_factory=list)
    agent_state: dict | None = None


class ToolCallCreate(BaseModel):
    session_id: str | None = None
    kind: str = Field(min_length=1, max_length=64)
    ok: bool = True
    source: str = Field(default="app", max_length=16)


@router.post("/api/sessions")
def create_session(req: SessionCreate, _user: str = Depends(get_current_user), db: DbSession = Depends(get_db)):
    """幂等创建会话（已存在则原样返回）。design_id 绑定时会校验设计归属。"""
    owner = _owner_id(db, _user)
    if req.design_id is not None:
        design = db.get(Design, req.design_id)
        if design is None or design.owner_id != owner:
            raise HTTPException(status_code=404, detail="设计稿不存在或无权访问")
    try:
        session, created = sessions_service.get_or_create_session(
            db, owner, req.session_key, title=req.title, design_id=req.design_id
        )
    except SessionValidationError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    body = sessions_service.session_meta(session)
    body["created"] = created
    return body


@router.get("/api/sessions")
def list_sessions(
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    _user: str = Depends(get_current_user),
    db: DbSession = Depends(get_db),
):
    """会话列表（只返回元信息，供侧边列表使用）。"""
    owner = _owner_id(db, _user)
    total = db.execute(
        select(func.count()).select_from(ChatSession).where(ChatSession.owner_id == owner)
    ).scalar_one()
    rows = db.execute(
        select(ChatSession)
        .where(ChatSession.owner_id == owner)
        .order_by(ChatSession.updated_at.desc(), ChatSession.id.desc())
        .offset(offset)
        .limit(limit)
    ).scalars().all()
    return {"sessions": [sessions_service.session_meta(s) for s in rows], "total": total}


@router.get("/api/sessions/{session_key}")
def get_session(session_key: str, _user: str = Depends(get_current_user), db: DbSession = Depends(get_db)):
    session = _own_session(db, _user, session_key)
    body = sessions_service.session_meta(session)
    body["agent_state"] = sessions_service.parse_agent_state(session.agent_state)
    return body


@router.patch("/api/sessions/{session_key}")
def patch_session(
    session_key: str, req: SessionPatch, _user: str = Depends(get_current_user), db: DbSession = Depends(get_db)
):
    """更新会话元信息（标题 / 绑定设计）。绑定设计时校验归属，防跨用户挂载。"""
    session = _own_session(db, _user, session_key)
    if req.title is not None:
        session.title = req.title
    if req.design_id is not None:
        design = db.get(Design, req.design_id)
        if design is None or design.owner_id != _owner_id(db, _user):
            raise HTTPException(status_code=404, detail="设计稿不存在或无权访问")
        session.design_id = req.design_id
    db.commit()
    db.refresh(session)
    return sessions_service.session_meta(session)


@router.delete("/api/sessions/{session_key}")
def delete_session(session_key: str, _user: str = Depends(get_current_user), db: DbSession = Depends(get_db)):
    """删除会话（连带消息与工具记录）——前端必须二次确认后再调用。"""
    session = _own_session(db, _user, session_key)
    sessions_service.delete_session(db, session)
    return {"ok": True}


@router.get("/api/sessions/{session_key}/messages")
def get_messages(
    session_key: str,
    limit: int = Query(default=50, ge=1, le=500),
    _user: str = Depends(get_current_user),
    db: DbSession = Depends(get_db),
):
    session = _own_session(db, _user, session_key)
    rows = sessions_service.list_messages(db, session, limit=limit)
    return {
        "messages": [
            {
                "id": m.id,
                "role": m.role,
                "text": m.content,
                "created_at": m.created_at.isoformat() if m.created_at else None,
            }
            for m in rows
        ]
    }


@router.post("/api/sessions/{session_key}/messages")
def append_messages(
    session_key: str, req: MessageAppend, _user: str = Depends(get_current_user), db: DbSession = Depends(get_db)
):
    """追加消息（可同时更新 Agent 状态）。跨会话声明一律 422。"""
    _assert_no_cross_session(session_key, req.session_id)
    session = _own_session(db, _user, session_key)
    try:
        pruned = sessions_service.append_messages(
            db, session, [m.model_dump() for m in req.messages], agent_state=req.agent_state
        )
    except SessionValidationError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    body = sessions_service.session_meta(session)
    body["pruned"] = pruned
    return body


@router.post("/api/sessions/{session_key}/clear")
def clear_session(session_key: str, _user: str = Depends(get_current_user), db: DbSession = Depends(get_db)):
    """清空当前会话的消息与 Agent 状态（不动其他会话）——前端二次确认后调用。"""
    session = _own_session(db, _user, session_key)
    sessions_service.clear_session(db, session)
    return {"ok": True, "session_id": session.session_key}


@router.post("/api/sessions/{session_key}/tool-calls")
def record_tool_call(
    session_key: str, req: ToolCallCreate, _user: str = Depends(get_current_user), db: DbSession = Depends(get_db)
):
    """记一条工具调用（Agent 运行记录）。只存 kind/来源/成败，不含用户文本。"""
    _assert_no_cross_session(session_key, req.session_id)
    session = _own_session(db, _user, session_key)
    try:
        call = sessions_service.record_tool_call(db, session, req.kind, req.ok, req.source)
    except SessionValidationError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {"ok": True, "id": call.id, "session_id": session.session_key}


@router.get("/api/sessions/{session_key}/tool-calls")
def get_tool_calls(
    session_key: str,
    limit: int = Query(default=50, ge=1, le=500),
    _user: str = Depends(get_current_user),
    db: DbSession = Depends(get_db),
):
    session = _own_session(db, _user, session_key)
    rows = sessions_service.list_tool_calls(db, session, limit=limit)
    return {
        "tool_calls": [
            {
                "id": c.id,
                "kind": c.kind,
                "source": c.source,
                "ok": c.ok,
                "created_at": c.created_at.isoformat() if c.created_at else None,
            }
            for c in rows
        ]
    }


@router.get("/api/sessions/{session_key}/context")
def get_context(
    session_key: str,
    max_turns: int = Query(default=10, ge=1, le=50),
    _user: str = Depends(get_current_user),
    db: DbSession = Depends(get_db),
):
    """Agent 可见上下文窗口（只含本会话消息；跨会话读取在数据面不可能发生）。"""
    session = _own_session(db, _user, session_key)
    rows = sessions_service.build_context(db, session, max_turns=max_turns)
    return {
        "session_id": session.session_key,
        "messages": [
            {"id": m.id, "session_id": session.session_key, "role": m.role, "text": m.content}
            for m in rows
        ],
    }


class BeautifyLockState(BaseModel):
    locked: bool


@router.get("/api/sessions/{session_key}/beautify-lock")
def get_beautify_lock(session_key: str, _user: str = Depends(get_current_user), db: DbSession = Depends(get_db)):
    """读版面锁定状态（T4 批1）：前端据此初始化 layoutLocked（刷新不丢锁）。"""
    _own_session(db, _user, session_key)
    return {"locked": sessions_service.get_lock(db, session_key)}


@router.post("/api/sessions/{session_key}/beautify-lock")
def set_beautify_lock(
    session_key: str, req: BeautifyLockState, _user: str = Depends(get_current_user), db: DbSession = Depends(get_db)
):
    """写版面锁定状态（T4 批1）：前端在确认版面/解除锁定时同步；服务端闸门的判定来源。"""
    _own_session(db, _user, session_key)
    sessions_service.set_lock(db, session_key, req.locked)
    return {"ok": True, "locked": req.locked}


class ApplyLockedEditRequest(BaseModel):
    # 锁状态由服务端按 session_key 查（B 决策）：请求体不含（也无法伪造）locked 声明
    session_key: str = Field(min_length=3, max_length=64)
    before: dict
    after: dict


@router.post("/api/apply-locked-edit")
def apply_locked_edit_endpoint(
    req: ApplyLockedEditRequest, _user: str = Depends(get_current_user), db: DbSession = Depends(get_db)
):
    """AI 修改结果落地闸门（T4 批1，缺陷 3 写入门层）。

    未锁定：直接放行 after（与改造前等价，不做校验）；已锁定：逐位置比对
    before/after——结构/文案/布局变化拒绝（ok=false + reason），合法预置效果
    落地，非预置值丢弃并记入 dropped。会话不存在/非本人 → 404，不默认放行。
    """
    _own_session(db, _user, req.session_key)
    if not sessions_service.get_lock(db, req.session_key):
        return {"ok": True, "design": req.after, "changed_ids": [], "dropped": [], "reason": ""}
    result = apply_locked_edit(req.before, req.after)
    return {
        "ok": result.ok,
        "design": result.design,
        "changed_ids": result.changed_ids,
        "dropped": result.dropped,
        "reason": result.reason,
    }
