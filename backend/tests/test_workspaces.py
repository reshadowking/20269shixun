"""T46a（提交 1）：注册建个人工作区 + 老数据幂等迁移。"""

from app.db import SessionLocal
from app.models import Design, User, Workspace, WorkspaceMember
from app.services.workspaces import ensure_personal_workspaces, personal_workspace_of


class TestRegister:
    def test_register_creates_user_and_personal_workspace(self, client):
        resp = client.post("/api/auth/register", json={"username": "alice", "password": "alice123"})
        assert resp.status_code == 200
        assert resp.json()["token"] and resp.json()["username"] == "alice"

        db = SessionLocal()
        try:
            user = db.query(User).filter(User.username == "alice").one()
            ws = personal_workspace_of(db, user.id)
            assert ws is not None and ws.owner_id == user.id
            member = db.query(WorkspaceMember).filter(
                WorkspaceMember.workspace_id == ws.id, WorkspaceMember.user_id == user.id
            ).one()
            assert member.role == "owner"
        finally:
            db.close()

    def test_register_duplicate_username_409(self, client):
        assert client.post("/api/auth/register", json={"username": "bob", "password": "bob12345"}).status_code == 200
        resp = client.post("/api/auth/register", json={"username": "bob", "password": "bob12345"})
        assert resp.status_code == 409

    def test_register_validation(self, client):
        assert client.post("/api/auth/register", json={"username": "a", "password": "x"}).status_code == 422
        assert client.post("/api/auth/register", json={"username": "bad name", "password": "ok12345"}).status_code == 422

    def test_registered_user_can_login(self, client):
        client.post("/api/auth/register", json={"username": "carol", "password": "carol123"})
        resp = client.post("/api/auth/login", json={"username": "carol", "password": "carol123"})
        assert resp.status_code == 200 and resp.json()["username"] == "carol"


class TestLegacyMigration:
    def test_duplicate_column_guard_covers_postgres_message(self):
        """T46a 回归：Postgres 的补列报错文案与 SQLite 不同，必须都被认作"已存在"。

        历史 P0：只认 SQLite 文案 → Postgres 上第二次启动直接崩（单测跑 SQLite，抓不到）。
        """
        from app.db import _is_duplicate_column

        assert _is_duplicate_column(Exception('duplicate column name: owner_id')) is True
        assert _is_duplicate_column(Exception('column "owner_id" of relation "images" already exists')) is True
        assert _is_duplicate_column(Exception("permission denied for table images")) is False

    def test_legacy_design_and_image_get_workspace(self, client, auth_headers):
        db = SessionLocal()
        try:
            user = db.query(User).filter(User.username == "demo").one()
            legacy = Design(name="老设计稿", owner_id=user.id, design_json="{}")
            db.add(legacy)
            db.commit()
            db.refresh(legacy)
            legacy_id = legacy.id
            # 迁移前：无归属
            assert db.get(Design, legacy_id).workspace_id is None

            ensure_personal_workspaces(db)
            ws = personal_workspace_of(db, user.id)
            assert ws is not None
            assert db.get(Design, legacy_id).workspace_id == ws.id
        finally:
            db.close()

    def test_migration_is_idempotent(self, client, auth_headers):
        db = SessionLocal()
        try:
            before = db.query(Workspace).count()
            ensure_personal_workspaces(db)
            ensure_personal_workspaces(db)
            after = db.query(Workspace).count()
            # 重复执行不新建重复工作区（每个用户恰好一个个人工作区）
            assert after == before
        finally:
            db.close()
