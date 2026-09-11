"""ORM 模型（v2.2 §9.2：users / designs / versions / images；缺陷 4 追加会话三表）。"""
from datetime import UTC, datetime

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    LargeBinary,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from .db import Base


def _now() -> datetime:
    return datetime.now(UTC)


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    username: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class Design(Base):
    __tablename__ = "designs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(200), default="未命名设计稿")
    owner_id: Mapped[int] = mapped_column(Integer, index=True)
    # 设计 JSON（toJSON 后的 DesignNode 树）
    design_json: Mapped[str] = mapped_column(Text, default="{}")
    # Yjs 实时文档状态由 y-websocket + leveldb 承担（B3-2 决策：实时状态与 PG 整树快照职责分离）；
    # PG 保存的是整树快照（design_json）。本列保留供未来"服务端 Yjs 持久化"方案 B 使用，当前无写入方。
    yjs_state: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class Version(Base):
    __tablename__ = "versions"
    # P0-5：并发保存防重——同设计同版本号唯一（_save_version 的读 latest+1 无锁，靠此约束兜底）
    __table_args__ = (UniqueConstraint("design_id", "version_no", name="uq_versions_design_no"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    design_id: Mapped[int] = mapped_column(Integer, ForeignKey("designs.id"), index=True)
    version_no: Mapped[int] = mapped_column(Integer, default=1)
    design_json: Mapped[str] = mapped_column(Text)
    note: Mapped[str] = mapped_column(String(200), default="")
    operator: Mapped[str] = mapped_column(String(64), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class Image(Base):
    __tablename__ = "images"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    filename: Mapped[str] = mapped_column(String(255))
    path: Mapped[str] = mapped_column(String(512))  # 相对 volume 路径
    design_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    size: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class ChatSession(Base):
    """画布会话（缺陷 4）：sessionId → 会话数据 的映射。

    session_key 是客户端与 URL 使用的字符串 id（s-xxxx / s-design-12），DB 自增 id 不对外；
    同一 key 在不同 owner 下是两条独立会话（唯一约束含 owner_id）。
    """

    __tablename__ = "chat_sessions"
    __table_args__ = (UniqueConstraint("owner_id", "session_key", name="uq_chat_sessions_owner_key"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    session_key: Mapped[str] = mapped_column(String(64), index=True)
    owner_id: Mapped[int] = mapped_column(Integer, index=True)
    title: Mapped[str] = mapped_column(String(200), default="新会话")
    design_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    # Agent 运行状态（上次需求/追问进度/合规报告等），JSON 字符串；不含消息正文
    agent_state: Mapped[str] = mapped_column(Text, default="{}")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)


class ChatMessage(Base):
    """会话消息（缺陷 4）：每条都归属一个会话，读取按 session_id 过滤。"""

    __tablename__ = "chat_messages"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    session_id: Mapped[int] = mapped_column(Integer, ForeignKey("chat_sessions.id"), index=True)
    role: Mapped[str] = mapped_column(String(16))  # user / assistant
    content: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class SessionToolCall(Base):
    """会话工具调用记录（缺陷 4）：只记 kind/来源/成败，不含用户文本（宪法第 3 条）。"""

    __tablename__ = "session_tool_calls"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    session_id: Mapped[int] = mapped_column(Integer, ForeignKey("chat_sessions.id"), index=True)
    kind: Mapped[str] = mapped_column(String(64))
    source: Mapped[str] = mapped_column(String(16), default="app")  # app / mcp
    ok: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
