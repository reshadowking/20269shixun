"""注册口限流（2026-09-17）。

登录口先补了限流，注册口当时漏了 —— 可以无限批量建号（每个号还自动带一个个人工作区）。
口径与登录不同：**每次注册调用都计费**（拦的是"批量建号"本身，只拦失败没有意义）；
按 IP 计数，返回 429；`register_rate_limit_per_minute = 0` 表示不限制。
"""
from app.config import get_settings
from app.services import rate_limit


def _limit(monkeypatch, value: int) -> None:
    monkeypatch.setattr(get_settings(), "register_rate_limit_per_minute", value)
    rate_limit._reset_for_tests()


def _register(client, username: str):
    return client.post("/api/auth/register", json={"username": username, "password": "pw123456"})


def test_registrations_are_rate_limited_per_ip(client, monkeypatch):
    _limit(monkeypatch, 3)

    for i in range(3):
        assert _register(client, f"rlreg_{i}").status_code == 200

    blocked = _register(client, "rlreg_overflow")
    assert blocked.status_code == 429
    assert "频繁" in blocked.json()["detail"]

    # 被限流时**不能**留下半成品账号（请求在校验用户名之前就返回了）
    assert client.post("/api/auth/login", json={"username": "rlreg_overflow", "password": "pw123456"}).status_code == 401


def test_failed_registrations_also_count(client, monkeypatch):
    """重复用户名也算一次（否则攻击者用重复名把桶打满但不计数，等于没限）。"""
    _limit(monkeypatch, 2)
    assert _register(client, "rlreg_dup").status_code == 200
    assert _register(client, "rlreg_dup").status_code == 409  # 重名
    assert _register(client, "rlreg_dup2").status_code == 429  # 两次已用尽


def test_zero_means_no_limit(client, monkeypatch):
    _limit(monkeypatch, 0)
    for i in range(6):
        assert _register(client, f"rlreg_off_{i}").status_code == 200
