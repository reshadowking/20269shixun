"""/api/auth/login 接口测试：状态码、参数校验、错误分支、SQL 注入 payload。"""
from app.security import decode_token


def test_login_success(client):
    resp = client.post("/api/auth/login", json={"username": "demo", "password": "demo123"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["username"] == "demo"
    assert decode_token(body["token"]) == "demo"


def test_login_wrong_password(client):
    resp = client.post("/api/auth/login", json={"username": "demo", "password": "wrong"})
    assert resp.status_code == 401
    assert "错误" in resp.json()["detail"]


def test_login_unknown_user(client):
    resp = client.post("/api/auth/login", json={"username": "nobody", "password": "demo123"})
    assert resp.status_code == 401


def test_login_missing_fields(client):
    resp = client.post("/api/auth/login", json={"username": "demo"})
    assert resp.status_code == 422  # pydantic 参数校验


def test_login_empty_password(client):
    resp = client.post("/api/auth/login", json={"username": "demo", "password": ""})
    assert resp.status_code == 422


def test_login_sql_injection_payload(client):
    """SQL 注入防护：注入 payload 必须走参数化查询，返回 401 而非 500/越权。"""
    payloads = [
        {"username": "demo' OR '1'='1", "password": "x"},
        {"username": "demo\" OR 1=1 --", "password": "x"},
        {"username": "'; DROP TABLE users; --", "password": "x"},
        {"username": "demo", "password": "' OR '1'='1"},
        {"username": "admin'--", "password": "x"},
    ]
    for payload in payloads:
        resp = client.post("/api/auth/login", json=payload)
        assert resp.status_code == 401, f"payload {payload} 应被拒绝，实际 {resp.status_code}"


def test_login_extremely_long_input(client):
    """超长输入防护：返回 422 参数校验错误，不崩溃。"""
    resp = client.post(
        "/api/auth/login",
        json={"username": "a" * 10000, "password": "b" * 10000},
    )
    assert resp.status_code == 422


def test_login_weird_types(client):
    resp = client.post("/api/auth/login", json={"username": 123, "password": ["x"]})
    assert resp.status_code == 422


class TestRegister:
    """开放注册（T46a）：重名 409；并发下的竞态也不能变成 500。"""

    def test_duplicate_username_returns_409(self, client):
        body = {"username": "auth_dup", "password": "secret123"}
        assert client.post("/api/auth/register", json=body).status_code == 200
        resp = client.post("/api/auth/register", json=body)
        assert resp.status_code == 409
        assert "占用" in resp.json()["detail"]

    def test_race_between_check_and_insert_is_409_not_500(self, client, monkeypatch):
        """并发注册同名：存在性检查与 INSERT 之间没有锁，第二个 INSERT 会撞 users.username 唯一约束。

        `register` 没有 IntegrityError 处理 → 未捕获异常（500）。同项目其它写入点
        （建文件夹 / 保存版本 / 幂等建会话）都做了 try/except → 409 或幂等，这里漏了。
        为**确定性地**复现那个竞态窗口，把"存在性检查"打桩成查不到（等价于另一个请求刚插进来）。
        """
        body = {"username": "auth_race", "password": "secret123"}
        assert client.post("/api/auth/register", json=body).status_code == 200  # 先占号

        from sqlalchemy.orm import Query

        original_first = Query.first

        def race_first(self):
            entity = (self.column_descriptions or [{}])[0].get("entity")
            if getattr(entity, "__name__", "") == "User":
                return None  # 模拟"检查通过时对方还没插进来"
            return original_first(self)

        monkeypatch.setattr(Query, "first", race_first)
        resp = client.post("/api/auth/register", json=body)
        assert resp.status_code == 409, f"竞态下应回 409（重名），实际 {resp.status_code}"
        assert "占用" in resp.json()["detail"]


class TestDemoAutoCreateRace:
    """"首次登录自动建号"（login 里的 demo 快捷路径）在并发下会撞 users.username。"""

    def test_concurrent_first_login_does_not_500(self, client, monkeypatch):
        """全新库上两个请求同时用 demo/demo123 登录：两边都该拿到 token。

        实测（把用户查询打桩成"查不到"，等价于另一个请求刚插进来）：
          sqlalchemy.exc.IntegrityError: UNIQUE constraint failed: users.username
        → 未捕获 → 500；而用户其实只是"两个人同时点了登录"。
        """
        # 先造出 demo 账号（其它用例也会建，这里显式保证前置）
        assert client.post("/api/auth/login", json={"username": "demo", "password": "demo123"}).status_code == 200

        from sqlalchemy.orm import Query

        original_first = Query.first
        calls = {"n": 0}

        def race_first(self):
            entity = (self.column_descriptions or [{}])[0].get("entity")
            if getattr(entity, "__name__", "") == "User":
                calls["n"] += 1
                if calls["n"] == 1:
                    return None  # 模拟"我查的时候还没人建号"
            return original_first(self)

        monkeypatch.setattr(Query, "first", race_first)
        resp = client.post("/api/auth/login", json={"username": "demo", "password": "demo123"})
        monkeypatch.setattr(Query, "first", original_first)

        assert resp.status_code == 200, f"并发首登应正常发 token，实际 {resp.status_code}"
        assert resp.json()["username"] == "demo"


class TestPasswordHashSaltMigration:
    """P1-1 事故回归：口令盐与 jwt_secret 解耦——轮换密钥不再把所有账号锁在门外。"""

    def test_legacy_hash_still_logs_in_and_gets_upgraded(self, client):
        """库里存的是"旧实现（jwt_secret 当盐）"的哈希时：仍能登录，且登录后已升级到当前盐。"""
        import hashlib

        from app.db import SessionLocal
        from app.models import User
        from app.security import get_settings

        legacy_hash = hashlib.sha256(
            f"{get_settings().jwt_secret}::demo123".encode()
        ).hexdigest()
        db = SessionLocal()
        try:
            user = db.query(User).filter(User.username == "demo").first()
            assert user is not None, "测试前置：demo 用户应由其它用例创建"
            user.password_hash = legacy_hash
            db.commit()
        finally:
            db.close()

        resp = client.post("/api/auth/login", json={"username": "demo", "password": "demo123"})
        assert resp.status_code == 200, resp.text

        from app.security import hash_password

        db = SessionLocal()
        try:
            user = db.query(User).filter(User.username == "demo").first()
            assert user.password_hash == hash_password("demo123")  # 已升级到当前盐
            assert user.password_hash != legacy_hash
        finally:
            db.close()

    def test_new_scheme_hash_unchanged_by_jwt_secret(self):
        """哈希只依赖 password_salt：改 .env 的 JWT_SECRET 不会改变同一口令的哈希。"""
        import hashlib

        from app.security import get_settings, hash_password

        assert hash_password("demo123") == hashlib.sha256(
            f"{get_settings().password_salt}::demo123".encode()
        ).hexdigest()
        assert get_settings().password_salt != get_settings().jwt_secret

    def test_wrong_password_still_rejected(self, client, auth_headers):
        resp = client.post("/api/auth/login", json={"username": "demo", "password": "wrong-password"})
        assert resp.status_code == 401
