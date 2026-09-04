"""ORM 模型（v2.2 §9.2：users / designs / versions / images）。"""
from datetime import UTC, datetime

from sqlalchemy import DateTime, ForeignKey, Integer, LargeBinary, String, Text, UniqueConstraint
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
