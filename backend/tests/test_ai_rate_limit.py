"""T22：限流与日 token 配额（429 语义；统计失败放行）。"""
from datetime import UTC, datetime

import pytest

from app.config import get_settings
from app.db import SessionLocal
from app.models import AiCall
from app.services import ai_ledger, rate_limit


@pytest.fixture(autouse=True)
def _reset():
    rate_limit._reset_for_tests()
    yield
    rate_limit._reset_for_tests()


class TestRateLimit:
    def test_per_user_limit_returns_429(self, client, auth_headers, monkeypatch):
        monkeypatch.setattr(get_settings(), "ai_rate_limit_per_minute", 2)
        for _ in range(2):
            assert client.post("/api/generate", json={"prompt": "设计一个登录页"}, headers=auth_headers).status_code == 200
        third = client.post("/api/generate", json={"prompt": "设计一个登录页"}, headers=auth_headers)
        assert third.status_code == 429
        assert "过于频繁" in third.json()["detail"]

    def test_explore_counts_double(self, client, auth_headers, monkeypatch):
        monkeypatch.setattr(get_settings(), "ai_rate_limit_per_minute", 1)
        resp = client.post("/api/generate/explore", json={"prompt": "设计一个登录页"}, headers=auth_headers)
        assert resp.status_code == 429  # cost=2 > 额度 1


class TestDailyQuota:
    def test_quota_exceeded_returns_429(self, client, auth_headers, monkeypatch):
        monkeypatch.setattr(get_settings(), "ai_daily_token_quota_per_user", 100)
        db = SessionLocal()
        try:
            db.add(AiCall(user="demo", kind="fill", ok=True, tokens_in=80, tokens_out=80, created_at=datetime.now(UTC)))
            db.commit()
        finally:
            db.close()
        resp = client.post("/api/generate", json={"prompt": "设计一个登录页"}, headers=auth_headers)
        assert resp.status_code == 429
        assert "用量已达上限" in resp.json()["detail"]

    def test_stats_failure_passes_through(self, client, auth_headers, monkeypatch):
        def boom(_user=None):
            raise RuntimeError("统计不可用")

        monkeypatch.setattr(ai_ledger, "tokens_today", boom)
        resp = client.post("/api/generate", json={"prompt": "设计一个登录页"}, headers=auth_headers)
        assert resp.status_code == 200
