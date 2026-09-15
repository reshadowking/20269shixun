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
    # T46a：归属工作区（NULL = 兼容期，读作创建人的个人工作区）
    workspace_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    # T46a-3：协作房间名（服务端签发、不可猜；首次访问 /collab 时生成并持久化，保证多人拿到同一个）
    collab_room: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
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
    # T38：资产归属（此前 images 表没有 owner：任何登录用户都能看到全部图片；资产库必须先补这一列）
    owner_id: Mapped[int] = mapped_column(Integer, default=0, index=True)
    # T46a：归属工作区（与 designs 同口径）
    workspace_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    # T46b：资产可见性——private(仅自己) / workspace(工作区成员) / public-link(凭链接任何人)
    visibility: Mapped[str] = mapped_column(String(16), default="private", index=True)
    # T44：所属资产文件夹（NULL = 根目录/未分组；删除文件夹时回落 NULL，不删资产）
    folder_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    filename: Mapped[str] = mapped_column(String(255))
    path: Mapped[str] = mapped_column(String(512))  # 相对 volume 路径
    design_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    size: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class AssetFolder(Base):
    """T44：资产文件夹（按账号组织素材，类似文件管理器的目录）。

    不做嵌套（一期只一层）：演示规模下"一层目录 + 未分组"已经够用，
    嵌套会把权限/移动/计数的复杂度放大好几倍。
    """

    __tablename__ = "asset_folders"
    __table_args__ = (UniqueConstraint("owner_id", "name", name="uq_asset_folders_owner_name"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    owner_id: Mapped[int] = mapped_column(Integer, index=True)
    name: Mapped[str] = mapped_column(String(64))
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


class Workspace(Base):
    """T46a：工作区——设计稿与资产的归属单位（替代"单用户拥有"）。"""

    __tablename__ = "workspaces"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    owner_id: Mapped[int] = mapped_column(Integer, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class WorkspaceMember(Base):
    """T46a：成员与角色（owner / editor / viewer）。"""

    __tablename__ = "workspace_members"
    __table_args__ = (UniqueConstraint("workspace_id", "user_id", name="uq_workspace_members"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    workspace_id: Mapped[int] = mapped_column(Integer, ForeignKey("workspaces.id"), index=True)
    user_id: Mapped[int] = mapped_column(Integer, index=True)
    role: Mapped[str] = mapped_column(String(16), default="editor")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class WorkspaceInvite(Base):
    """T46a：一次性邀请（token 用后失效；可设过期）。"""

    __tablename__ = "workspace_invites"

    token: Mapped[str] = mapped_column(String(64), primary_key=True)
    workspace_id: Mapped[int] = mapped_column(Integer, ForeignKey("workspaces.id"), index=True)
    role: Mapped[str] = mapped_column(String(16), default="editor")
    created_by: Mapped[int] = mapped_column(Integer)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    used_by: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class DesignLock(Base):
    """版面锁定状态（T4 批1，B2 决策：独立小表）。

    锁是"画布/流程状态"，不借宿 chat_sessions.agent_state（该字段整体覆盖写入且
    有聊天路径并发写入方，见任务卡 §7.1 否决 B1 的证据）。服务端闸门据此表判定
    锁状态，不接受请求体声明——前端在确认版面/解除锁定时同步写入。
    create_all 自动建表，无需启动期修补。
    """

    __tablename__ = "design_locks"

    session_key: Mapped[str] = mapped_column(String(64), primary_key=True)
    locked: Mapped[bool] = mapped_column(Boolean, default=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)


class AiCall(Base):
    """T21：AI 调用记账（**不含任何用户文本**，宪法 §二.3）。

    一次生成会产生多条（意图解析 / 摘要 / 填充，含重试与备用模型切换），按 kind 区分。
    prompt_version 由 system 文本的 sha256 前 12 位自动生成（防"忘改版本号"）。
    """

    __tablename__ = "ai_calls"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    session_key: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    user: Mapped[str] = mapped_column(String(64), default="", index=True)  # T22：按用户统计日配额
    kind: Mapped[str] = mapped_column(String(16), default="")
    model: Mapped[str] = mapped_column(String(64), default="")
    prompt_version: Mapped[str] = mapped_column(String(16), default="")
    tokens_in: Mapped[int] = mapped_column(Integer, default=0)
    tokens_out: Mapped[int] = mapped_column(Integer, default=0)
    latency_ms: Mapped[int] = mapped_column(Integer, default=0)
    ok: Mapped[bool] = mapped_column(Boolean, default=True)
    error_code: Mapped[str] = mapped_column(String(64), default="")
    fallback: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, index=True)
