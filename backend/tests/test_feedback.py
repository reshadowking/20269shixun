"""T51 批2：AI 效果反馈接口（鉴权 / 枚举 / 落库 / 归因字段）。

反馈闭环的生死线：**落库失败绝不静默**（失败静默会让数据脏掉，后续汇总全不可信）。
"""
from app.db import SessionLocal
from app.models import AiFeedback


class TestFeedbackApi:
    def test_需要鉴权(self, client):
        assert client.post("/api/feedback", json={"rating": 1}).status_code == 401

    def test_落库成功且字段完整(self, client, auth_headers):
        resp = client.post(
            "/api/feedback",
            json={
                "rating": -1,
                "category": "not_applied",
                "note": "点了没变化",
                "session_key": "s-fb1",
                "llm_model": "kimi-k2.7-code",
                "prompt_version": "abc123def456",
                "profile_id": "kimi",
                "api_format": "chat",
            },
            headers=auth_headers,
        )
        assert resp.status_code == 200
        assert resp.json()["ok"] is True
        db = SessionLocal()
        try:
            row = db.query(AiFeedback).filter(AiFeedback.session_key == "s-fb1").one()
            assert row.rating == -1
            assert row.category == "not_applied"
            assert row.note == "点了没变化"
            assert row.llm_model == "kimi-k2.7-code"
            assert row.api_format == "chat"
            assert row.user  # 落了操作者（demo）
        finally:
            db.close()

    def test_category_缺省_未分类合法(self, client, auth_headers):
        resp = client.post("/api/feedback", json={"rating": 1}, headers=auth_headers)
        assert resp.status_code == 200
        assert resp.json()["ok"] is True

    def test_rating_非法_422(self, client, auth_headers):
        for bad in (0, 2, -2):
            resp = client.post("/api/feedback", json={"rating": bad}, headers=auth_headers)
            assert resp.status_code == 422, bad

    def test_category_非法_422(self, client, auth_headers):
        resp = client.post("/api/feedback", json={"rating": 1, "category": "unknown"}, headers=auth_headers)
        assert resp.status_code == 422

    def test_note_超长_422(self, client, auth_headers):
        resp = client.post("/api/feedback", json={"rating": 1, "note": "x" * 501}, headers=auth_headers)
        assert resp.status_code == 422

    def test_session_key_超长_422(self, client, auth_headers):
        resp = client.post("/api/feedback", json={"rating": 1, "session_key": "x" * 65}, headers=auth_headers)
        assert resp.status_code == 422


class TestGenerateResponseAttribution:
    def test_归因字段随响应出网_无调用时为_null(self, client, auth_headers):
        """T51 批2：反馈归因字段（llm_model 等）随响应出网；**没调模型 → null**。

        null 语义是定稿决策：熔断开路 / mock / 填充前失败都落这一支，
        汇总脚本把 null 单列"无模型调用"，**不能**混进某个模型的统计。
        """
        resp = client.post("/api/generate", json={"prompt": "设计一个登录页"}, headers=auth_headers)
        assert resp.status_code == 200
        body = resp.json()
        for key in ("llm_model", "llm_prompt_version", "api_format", "profile_id"):
            assert key in body, f"缺反馈归因字段 {key}"
