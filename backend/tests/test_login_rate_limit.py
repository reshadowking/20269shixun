"""登录口的凭证尝试限流（2026-09-17）。

此前 `/api/auth/login` 完全没有限制：口令可被无限次高速猜测（生成接口早就有 rate_limit，
登录口漏了）。口径：

- 按 **ip + 用户名** 计费（只对失败计费）→ 正常登录永远不受影响；
  带 ip 是为了避免"任何人刷错口令就能把别人的账号锁一分钟"；
- 用尽后返回 **429**（而不是继续 401），如实告知"太频繁了"。
"""
from app.config import get_settings
from app.services import rate_limit


def _register(client, username: str, password: str = "pw123456") -> None:
    resp = client.post("/api/auth/register", json={"username": username, "password": password})
    assert resp.status_code == 200, resp.text


def _login(client, username: str, password: str):
    return client.post("/api/auth/login", json={"username": username, "password": password})


def _limit(monkeypatch, value: int) -> None:
    monkeypatch.setattr(get_settings(), "login_rate_limit_per_minute", value)
    rate_limit._reset_for_tests()


def test_failures_are_rate_limited(client, monkeypatch):
    _limit(monkeypatch, 3)
    _register(client, "rl_user")

    for _ in range(3):
        assert _login(client, "rl_user", "wrong-password").status_code == 401

    # 第 4 次：额度用尽 → 429（不是继续放行去猜）
    blocked = _login(client, "rl_user", "wrong-password")
    assert blocked.status_code == 429
    assert "频繁" in blocked.json()["detail"]
    # 此刻连正确口令也会被挡（额度已满），如实返回 429 而不是 401
    assert _login(client, "rl_user", "pw123456").status_code == 429


def test_successful_login_does_not_consume_and_clears_previous_failures(client, monkeypatch):
    _limit(monkeypatch, 3)
    _register(client, "rl_ok")

    # 手滑两次（没打满）
    assert _login(client, "rl_ok", "nope").status_code == 401
    assert _login(client, "rl_ok", "nope").status_code == 401
    # 正确口令一次就进（成功后清掉该 key 的失败计数）
    assert _login(client, "rl_ok", "pw123456").status_code == 200

    # 计数被清过：可以再错 3 次，第 4 次才 429
    for _ in range(3):
        assert _login(client, "rl_ok", "nope").status_code == 401
    assert _login(client, "rl_ok", "nope").status_code == 429


def test_limit_is_per_ip_and_username(client, monkeypatch):
    """一个账号被打满，不影响另一个账号；同一个用户名换个来源也不受影响。"""
    _limit(monkeypatch, 2)
    _register(client, "rl_a")
    _register(client, "rl_b")

    for _ in range(2):
        assert _login(client, "rl_a", "nope").status_code == 401
    assert _login(client, "rl_a", "nope").status_code == 429

    assert _login(client, "rl_b", "nope").status_code == 401  # 另一个用户名：照常
    assert _login(client, "rl_b", "pw123456").status_code == 200


def test_zero_means_no_limit(client, monkeypatch):
    """0 = 不限制（与 ai_rate_limit_per_minute 同一约定，见 config.py 注释）。"""
    _limit(monkeypatch, 0)
    _register(client, "rl_off")

    for _ in range(8):
        assert _login(client, "rl_off", "nope").status_code == 401
