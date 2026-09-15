"""会话服务（缺陷 4）：sessionId → 会话数据 的映射与访问控制。

职责：
- 幂等创建/查询（同 owner 同 key 唯一）；
- 消息追加与保留上限裁剪；
- Agent 状态（JSON）读写；
- 工具调用记账（不含用户文本）；
- Agent 上下文窗口（只可能来自该会话）。
所有函数都接收 owner 校验后的会话对象或 owner_id，越权路径在 router 层转 404/422。
"""
import json
import re
from datetime import UTC, datetime

from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session as DbSession

from ..models import ChatMessage, ChatSession, DesignLock, SessionToolCall, User

SESSION_KEY_RE = re.compile(r"^[A-Za-z0-9_-]{3,64}$")
MAX_MESSAGES = 200
MESSAGE_LIST_LIMIT = 500
ROLES = {"user", "assistant"}
DEFAULT_TITLE = "新会话"
TOOL_SOURCES = {"app", "mcp"}
TITLE_MAX_CHARS = 20


class SessionValidationError(ValueError):
    """参数非法（router 转 422）。"""


def validate_session_key(key: str) -> str:
    if not isinstance(key, str) or not SESSION_KEY_RE.match(key):
        raise SessionValidationError("session_key 只能是 3-64 位字母/数字/下划线/短横线")
    return key


def _title_from_message(text: str) -> str:
    title = text.strip().replace("\n", " ")
    return title[:TITLE_MAX_CHARS] + ("…" if len(title) > TITLE_MAX_CHARS else "")


def get_owned_session(db: DbSession, owner_id: int, key: str) -> ChatSession | None:
    """按 owner + key 取会话；他人会话返回 None（router 统一 404，不泄漏存在性）。"""
    return db.execute(
        select(ChatSession).where(ChatSession.owner_id == owner_id, ChatSession.session_key == key)
    ).scalar_one_or_none()


def owner_id_of(db: DbSession, username: str) -> int | None:
    """用户名 → owner_id；用户不存在返回 None（403/404 的判定留给 router 层）。

    T24：history 服务需要"查不到就安全降级"，不能 import router 的私有 _owner_id（会翻层）。
    """
    return db.execute(select(User.id).where(User.username == username)).scalar_one_or_none()


def get_or_create_session(
    db: DbSession, owner_id: int, key: str, title: str | None = None, design_id: int | None = None
) -> tuple[ChatSession, bool]:
    """幂等创建：已存在则原样返回（不覆盖标题/绑定），不存在才新建。

    并发安全：两个请求同时通过"不存在"检查时会一起 INSERT，后到的撞唯一约束
    uq_chat_sessions_owner_key。此处捕获 IntegrityError 后回滚回查，返回对手已建好的那条
    （幂等语义），而不是把 500 冒给用户——会话其实已经建成功了，报错是假失败。
    """
    validate_session_key(key)
    existing = get_owned_session(db, owner_id, key)
    if existing is not None:
        return existing, False
    session = ChatSession(
        session_key=key,
        owner_id=owner_id,
        title=(title or "").strip() or DEFAULT_TITLE,
        design_id=design_id,
    )
    db.add(session)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        existing = get_owned_session(db, owner_id, key)
        if existing is None:  # 不是"对手已插入"这类可恢复冲突 → 原样抛出
            raise
        return existing, False
    db.refresh(session)
    return session, True


def _touch(db: DbSession, session: ChatSession) -> None:
    session.updated_at = datetime.now(UTC)
    db.add(session)


def append_messages(
    db: DbSession, session: ChatSession, items: list[dict], agent_state: dict | None = None
) -> int:
    """追加消息（批量）；返回被裁掉的旧消息条数。首条 user 消息自动当标题。"""
    created: list[ChatMessage] = []
    for item in items:
        role = item.get("role")
        text = item.get("text")
        if role not in ROLES:
            raise SessionValidationError(f"role 必须是 user/assistant，收到：{role!r}")
        if not isinstance(text, str) or not text.strip():
            raise SessionValidationError("消息内容不能为空")
        created.append(ChatMessage(session_id=session.id, role=role, content=text))
    if created:
        db.add_all(created)

    if agent_state is not None:
        session.agent_state = json.dumps(agent_state, ensure_ascii=False)

    # 标题：仍是默认值且出现首条 user 消息时自动命名（会话列表可读）
    if session.title == DEFAULT_TITLE:
        first_user = next((c.content for c in created if c.role == "user"), None)
        if first_user:
            session.title = _title_from_message(first_user)

    _touch(db, session)
    db.commit()

    return _prune(db, session)


def _prune(db: DbSession, session: ChatSession) -> int:
    total = db.execute(
        select(func.count()).select_from(ChatMessage).where(ChatMessage.session_id == session.id)
    ).scalar_one()
    overflow = total - MAX_MESSAGES
    if overflow <= 0:
        return 0
    old_ids = db.execute(
        select(ChatMessage.id).where(ChatMessage.session_id == session.id).order_by(ChatMessage.id.asc()).limit(overflow)
    ).scalars().all()
    if old_ids:
        db.execute(delete(ChatMessage).where(ChatMessage.id.in_(old_ids)))
        db.commit()
    return len(old_ids)


def list_messages(db: DbSession, session: ChatSession, limit: int = 50) -> list[ChatMessage]:
    """按时间正序返回最近 limit 条（只取本会话）。"""
    rows = db.execute(
        select(ChatMessage)
        .where(ChatMessage.session_id == session.id)
        .order_by(ChatMessage.id.desc())
        .limit(max(1, min(limit, MESSAGE_LIST_LIMIT)))
    ).scalars().all()
    return list(reversed(rows))


def clear_session(db: DbSession, session: ChatSession) -> None:
    """清空消息与工具记录（保留会话元信息与标题），只影响本会话。"""
    db.execute(delete(ChatMessage).where(ChatMessage.session_id == session.id))
    db.execute(delete(SessionToolCall).where(SessionToolCall.session_id == session.id))
    session.agent_state = "{}"
    _touch(db, session)
    db.commit()


def delete_session(db: DbSession, session: ChatSession) -> None:
    db.execute(delete(ChatMessage).where(ChatMessage.session_id == session.id))
    db.execute(delete(SessionToolCall).where(SessionToolCall.session_id == session.id))
    db.delete(session)
    db.commit()


def record_tool_call(db: DbSession, session: ChatSession, kind: str, ok: bool, source: str = "app") -> SessionToolCall:
    if not kind or len(kind) > 64:
        raise SessionValidationError("kind 必须是 1-64 字符")
    if source not in TOOL_SOURCES:
        raise SessionValidationError(f"source 必须是 {sorted(TOOL_SOURCES)} 之一")
    call = SessionToolCall(session_id=session.id, kind=kind, ok=bool(ok), source=source)
    db.add(call)
    _touch(db, session)
    db.commit()
    db.refresh(call)
    return call


def list_tool_calls(db: DbSession, session: ChatSession, limit: int = 50) -> list[SessionToolCall]:
    return list(
        db.execute(
            select(SessionToolCall)
            .where(SessionToolCall.session_id == session.id)
            .order_by(SessionToolCall.id.desc())
            .limit(max(1, min(limit, MESSAGE_LIST_LIMIT)))
        ).scalars().all()
    )


def build_context(db: DbSession, session: ChatSession, max_turns: int = 10) -> list[ChatMessage]:
    """Agent 上下文窗口：只从本会话取最近 max_turns 轮（user+assistant 记一轮）。"""
    limit = max(1, min(max_turns, 50)) * 2
    return list_messages(db, session, limit=limit)


def session_meta(session: ChatSession) -> dict:
    return {
        "session_id": session.session_key,
        "title": session.title,
        "design_id": session.design_id,
        "created_at": session.created_at.isoformat() if session.created_at else None,
        "updated_at": session.updated_at.isoformat() if session.updated_at else None,
    }


def parse_agent_state(raw: str) -> dict:
    try:
        parsed = json.loads(raw or "{}")
        return parsed if isinstance(parsed, dict) else {}
    except json.JSONDecodeError:
        return {}


# ---- T4 批1：版面锁定状态持久化（B2 决策：独立 design_locks 表）----


def get_lock(db: DbSession, session_key: str) -> bool:
    """读取会话的版面锁定状态；无记录视为未锁定。"""
    row = db.get(DesignLock, session_key)
    return bool(row and row.locked)


def set_lock(db: DbSession, session_key: str, locked: bool) -> None:
    """写入会话的版面锁定状态（upsert）。调用方需先完成 owner 校验。"""
    row = db.get(DesignLock, session_key)
    if row is None:
        db.add(DesignLock(session_key=session_key, locked=locked))
    else:
        row.locked = locked
    db.commit()
