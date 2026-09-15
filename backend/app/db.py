"""数据库连接与会话管理（SQLAlchemy 2.x，全部 ORM 参数化查询，禁止字符串拼 SQL）。"""
import logging

from sqlalchemy import create_engine, text
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from .config import get_settings

logger = logging.getLogger(__name__)


class Base(DeclarativeBase):
    pass


def _make_engine(url: str):
    # SQLite 测试环境需要 check_same_thread=False
    connect_args = {"check_same_thread": False} if url.startswith("sqlite") else {}
    return create_engine(url, connect_args=connect_args, pool_pre_ping=True)


engine = _make_engine(get_settings().pg_url)
SessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False)


def get_db():
    """FastAPI 依赖：请求级会话。"""
    db: Session = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db() -> None:
    """建表（v1 用 create_all，二期再引入迁移）。"""
    from . import models  # noqa: F401  确保模型已注册

    Base.metadata.create_all(bind=engine)
    _ensure_version_unique_index()
    _ensure_image_owner_column()
    _ensure_image_visibility_column()
    _ensure_workspace_columns()
    _ensure_collab_room_column()
    _seed_personal_workspaces()


def _is_duplicate_column(exc: Exception) -> bool:
    """补列是否"已存在"——**两个数据库的文案不同，必须都认**：

    - SQLite：`duplicate column name: owner_id`
    - Postgres：`column "owner_id" of relation "images" already exists`

    历史教训（P0）：只匹配 SQLite 文案时，Postgres 上**第二次启动必崩**（首次补列成功、
    第二次 ADD COLUMN 撞已存在 → 守卫没认出来 → raise → 应用启动失败）；而单测跑 SQLite，
    永远抓不到这类"只在真实库出现"的分支。
    """
    message = str(exc).lower()
    return "duplicate column" in message or "already exists" in message


def _add_column(conn, table: str, column: str, ddl: str) -> None:
    """补列（幂等）：ALTER 必须包在 SAVEPOINT 里，光认报错文案不够。

    P0（2026-09-15 实测）：Postgres 上失败的 DDL 会把**整个事务**打成 aborted；
    异常被守卫吞掉也没用——同一事务里紧随其后的 `CREATE INDEX` 会抛
    `InFailedSqlTransaction` → 启动照样崩（全新库第一次就崩，老库第二次崩）。
    SAVEPOINT 让失败只回滚这一条语句，外层事务继续可用；SQLite 同样支持，
    所以这层保护在两个库上都能跑（`ADD COLUMN IF NOT EXISTS` 是 Postgres 专有，会挂 SQLite 单测）。
    """
    try:
        with conn.begin_nested():
            conn.execute(text(ddl))
    except Exception as exc:
        if not _is_duplicate_column(exc):
            logger.error("%s.%s 迁移失败：%s", table, column, exc)
            raise


def _ensure_collab_room_column() -> None:
    """T46a-3：给既有库的 designs 补 collab_room（幂等）。"""
    with engine.begin() as conn:
        _add_column(conn, "designs", "collab_room", "ALTER TABLE designs ADD COLUMN collab_room VARCHAR(64)")
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_designs_collab_room ON designs (collab_room)"))


def _ensure_workspace_columns() -> None:
    """T46a：给既有库的 designs/images 补 workspace_id（幂等）。"""
    with engine.begin() as conn:
        for table in ("designs", "images"):
            _add_column(conn, table, "workspace_id", f"ALTER TABLE {table} ADD COLUMN workspace_id INTEGER")
            conn.execute(text(f"CREATE INDEX IF NOT EXISTS ix_{table}_workspace_id ON {table} (workspace_id)"))


def _seed_personal_workspaces() -> None:
    """T46a：启动时补齐个人工作区并把无归属老数据迁进去（幂等，失败不阻塞启动）。"""
    from .services.workspaces import ensure_personal_workspaces

    session = SessionLocal()
    try:
        migrated = ensure_personal_workspaces(session)
        if migrated:
            logger.info("工作区迁移：%s 个设计稿归入个人工作区", migrated)
    except Exception as exc:  # noqa: BLE001 - 迁移失败要让服务能起来，但错误必须可见
        logger.error("个人工作区初始化失败：%s", exc)
    finally:
        session.close()


def _ensure_image_owner_column() -> None:
    """T38：给既有库的 images 表补 owner_id（create_all 不会改已存在的表）。

    幂等：列已存在的报错被吞掉；其它错误显式暴露（不静默失守）。
    """
    with engine.begin() as conn:
        _add_column(conn, "images", "owner_id", "ALTER TABLE images ADD COLUMN owner_id INTEGER DEFAULT 0")
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_images_owner_id ON images (owner_id)"))


def _ensure_image_visibility_column() -> None:
    """T46b：给既有库的 images 补 visibility（幂等）。

    老资产一律落到 `private`（最保守），但"被某份我看得见的稿件引用"仍然可读
    （见 `routers/images.py` 的读取判定），所以升级后协作方不会突然缺图。
    """
    with engine.begin() as conn:
        _add_column(
            conn,
            "images",
            "visibility",
            "ALTER TABLE images ADD COLUMN visibility VARCHAR(16) DEFAULT 'private'",
        )
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_images_visibility ON images (visibility)"))


def _ensure_version_unique_index() -> None:
    """既有库补 (design_id, version_no) 唯一索引（P0-5 并发防重）。

    新库由 create_all 直接建出含约束的表；旧库先清理历史重复（保留每组最新一行），
    再补唯一索引。任一步失败显式报错提示人工处理，不让约束静默失效。
    """
    with engine.begin() as conn:
        conn.execute(
            text("DELETE FROM versions WHERE id NOT IN (SELECT MAX(id) FROM versions GROUP BY design_id, version_no)")
        )
    try:
        with engine.begin() as conn:
            conn.execute(
                text("CREATE UNIQUE INDEX IF NOT EXISTS uq_versions_design_no ON versions (design_id, version_no)")
            )
    except Exception as exc:  # noqa: BLE001 - 启动期索引失败需要显式暴露
        logger.error("版本唯一索引创建失败：%s。请人工检查 versions 表重复数据后重试。", exc)
