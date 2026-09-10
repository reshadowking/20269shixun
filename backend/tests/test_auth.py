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
