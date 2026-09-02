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
