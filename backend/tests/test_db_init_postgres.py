"""P0 回归：Postgres 上 ``init_db()`` 必须能「连起两次」。

背景（2026-09-15 真实栈实测）：``_ensure_*`` 里的 ``ADD COLUMN`` 撞「已存在」时，
Postgres 会把**整个事务**打成 aborted；异常即使被守卫吞掉，同一事务里紧随其后的
``CREATE INDEX IF NOT EXISTS`` 仍会抛 ``InFailedSqlTransaction`` → 应用启动崩
（全新库第一次就崩；老库首次补列成功后，第二次启动崩）。

SQLite 的失败 DDL **不污染事务**，所以跑 SQLite 的常规单测永远抓不到这类分支——
必须有这条真的打 Postgres 的用例。用例自建一个一次性库、跑完自删，不碰开发库。

跑法::

    TEST_POSTGRES_URL=postgresql+psycopg://postgres:postgres@localhost:5432/postgres \
        .venv/Scripts/python.exe -m pytest tests/test_db_init_postgres.py -q

不设 ``TEST_POSTGRES_URL`` 时整文件 skip，不影响常规 pytest。
"""
import os
import uuid

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

TEST_URL = os.environ.get("TEST_POSTGRES_URL", "")

pytestmark = pytest.mark.skipif(
    not TEST_URL.startswith("postgresql"),
    reason=(
        "P0 事故回归（2026-09-15）：Postgres 上 ALTER 撞「已存在」会把整个事务打成 aborted，"
        "后续 CREATE INDEX 必崩、应用二次启动失败——SQLite 复现不了，必须打真 Postgres。"
        "启用：TEST_POSTGRES_URL=postgresql+psycopg://postgres:postgres@localhost:5432/postgres"
        "（CI 已内置 service，本地需 Docker 的 design-postgres 在跑）"
    ),
)


def _with_db(url: str, name: str) -> str:
    """把连接串的库名换成 name（CREATE/DROP DATABASE 只能在维护库上跑）。"""
    return url.rsplit("/", 1)[0] + f"/{name}"


def columns_of(conn) -> set[tuple[str, str]]:
    """升级涉及的两种表的 (表名, 列名) 集合。"""
    return {
        (row[0], row[1])
        for row in conn.execute(
            text(
                "SELECT table_name, column_name FROM information_schema.columns "
                "WHERE table_name IN ('images', 'designs')"
            )
        )
    }


@pytest.fixture()
def scratch_db_url():
    """建一个一次性库，用完 DROP（不触碰开发库）。"""
    name = f"probe_initdb_{uuid.uuid4().hex[:8]}"
    admin = create_engine(_with_db(TEST_URL, "postgres"), isolation_level="AUTOCOMMIT", pool_pre_ping=True)
    with admin.connect() as conn:
        conn.execute(text(f'CREATE DATABASE "{name}"'))
    try:
        yield _with_db(TEST_URL, name)
    finally:
        try:
            with admin.connect() as conn:
                conn.execute(text(f'DROP DATABASE "{name}" WITH (FORCE)'))
        except Exception:  # noqa: BLE001 - PG < 13 没有 FORCE，退化成普通 DROP
            with admin.connect() as conn:
                conn.execute(text(f'DROP DATABASE "{name}"'))
        admin.dispose()


def test_init_db_new_and_old_schema_on_postgres(scratch_db_url, monkeypatch):
    """两条路径都要在 Postgres 上真跑（修好前第一条就崩在 CREATE INDEX 的 InFailedSqlTransaction）：

    1. **全新库首启**：``create_all`` 已经建出这些列 → 补列必然撞「已存在」（savepoint 分支）；
    2. **老库升级**：把列删掉造出升级前形态 → 补列成功、索引补上；
    3. **老库二启**：又撞「已存在」→ 仍不许把事务打死。
    """
    from app import db as app_db

    probe = create_engine(scratch_db_url, pool_pre_ping=True)
    monkeypatch.setattr(app_db, "engine", probe)
    monkeypatch.setattr(app_db, "SessionLocal", sessionmaker(bind=probe, autocommit=False, autoflush=False))
    legacy_columns = (
        ("images", "owner_id"),
        ("images", "workspace_id"),
        ("designs", "workspace_id"),
        ("designs", "collab_room"),
    )
    try:
        app_db.init_db()  # 1. 新库：补列撞"已存在"

        with probe.begin() as conn:  # 2. 造出"升级前"的老库形态
            for table, column in legacy_columns:
                conn.execute(text(f"ALTER TABLE {table} DROP COLUMN {column}"))
        # 确认老库形态真的造出来了（否则这条用例只是"看起来很忙"）。
        # 注意按 (表, 列) 判定：designs 本来就该有 owner_id，不能按列名一把抓。
        with probe.connect() as conn:
            leftovers = columns_of(conn) & set(legacy_columns)
        assert not leftovers, f"老库形态没造干净，这些列还在：{sorted(leftovers)}"

        app_db.init_db()  # 2. 老库升级：补列成功 + 补索引
        app_db.init_db()  # 3. 老库二启：补列撞"已存在"

        with probe.connect() as conn:
            columns = columns_of(conn)
            design_indexes = {
                row[0]
                for row in conn.execute(text("SELECT indexname FROM pg_indexes WHERE tablename = 'designs'"))
            }
        # 补列 + 索引真的落地了（不是"吞掉错误但什么也没做"）
        assert set(legacy_columns) <= columns
        assert {"ix_designs_workspace_id", "ix_designs_collab_room"} <= design_indexes
    finally:
        probe.dispose()
