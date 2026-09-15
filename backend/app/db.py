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


def _ensure_image_owner_column() -> None:
    """T38：给既有库的 images 表补 owner_id（create_all 不会改已存在的表）。

    幂等：列已存在的报错被吞掉；其它错误显式暴露（不静默失守）。
    """
    with engine.begin() as conn:
        try:
            conn.execute(text("ALTER TABLE images ADD COLUMN owner_id INTEGER DEFAULT 0"))
        except Exception as exc:
            if "duplicate column" not in str(exc).lower():
                logger.error("images.owner_id 迁移失败：%s", exc)
                raise
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_images_owner_id ON images (owner_id)"))


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
