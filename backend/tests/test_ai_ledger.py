"""T21：AI 调用记账（ai_calls 表）——真实记录、失败留痕、隐私边界、旁路容错。

通过替换 `llm.OpenAI` 造出"真实调用"：这样 `_create` 与记账代码全部真实执行，且零网络。
"""
from types import SimpleNamespace

from app.db import SessionLocal
from app.models import AiCall
from app.services import ai_ledger
from app.services.llm import prompt_version


class _FakeCompletions:
    def __init__(self, *, fail: bool = False):
        self.fail = fail

    def create(self, **kwargs):
        if self.fail:
            raise RuntimeError("模拟模型不可用")
        return SimpleNamespace(
            model="fake-model",
            usage=SimpleNamespace(prompt_tokens=11, completion_tokens=22),
            # 有效 DesignNode：意图解析会把它当意图（无 template 键 → 走关键词），填充则直接可用
            choices=[
                SimpleNamespace(
                    message=SimpleNamespace(content='{"id":"ledger-root","type":"frame","children":[]}'),
                    finish_reason="stop",
                )
            ],
        )


def _fake_openai(monkeypatch, completions: _FakeCompletions) -> None:
    from app.services import llm as llm_module

    class FakeOpenAI:
        def __init__(self, **_kwargs):
            self.chat = SimpleNamespace(completions=completions)

    monkeypatch.setattr(llm_module, "OpenAI", FakeOpenAI)
    monkeypatch.setattr(llm_module.LLMClient, "is_mock", property(lambda self: False))


def _rows(session_key: str) -> list[AiCall]:
    db = SessionLocal()
    try:
        return list(db.query(AiCall).filter(AiCall.session_key == session_key).all())
    finally:
        db.close()


class TestRecording:
    def test_success_writes_rows(self, client, auth_headers, monkeypatch):
        _fake_openai(monkeypatch, _FakeCompletions())
        resp = client.post(
            "/api/generate", json={"prompt": "设计一个登录页", "session_key": "s-ledger-ok"}, headers=auth_headers
        )
        assert resp.status_code == 200
        rows = _rows("s-ledger-ok")
        assert rows, "生成成功却没有落任何调用记录"
        assert any(r.kind == "fill" and r.ok and r.tokens_out == 22 for r in rows)
        assert all(len(r.prompt_version) == 12 for r in rows if r.ok)
        assert all(r.model for r in rows if r.ok)
        assert all(r.fallback is False for r in rows)

    def test_failure_writes_error_code(self, client, auth_headers, monkeypatch):
        _fake_openai(monkeypatch, _FakeCompletions(fail=True))
        resp = client.post(
            "/api/generate", json={"prompt": "设计一个登录页", "session_key": "s-ledger-fail"}, headers=auth_headers
        )
        assert resp.status_code == 200
        assert resp.json()["fallback"] is True
        rows = _rows("s-ledger-fail")
        assert rows and all(r.ok is False for r in rows)
        assert all(r.error_code for r in rows)
        assert all(r.fallback is True for r in rows)


class TestProvenanceAndPrivacy:
    def test_prompt_version_tracks_prompt_text(self):
        assert prompt_version("A") != prompt_version("B")
        assert len(prompt_version("A")) == 12

    def test_table_has_no_user_text_columns(self):
        columns = set(AiCall.__table__.columns.keys())
        assert not ({"content", "prompt", "user_text", "text", "design_json"} & columns)

    def test_ledger_failure_does_not_break_generation(self, client, auth_headers, monkeypatch):
        _fake_openai(monkeypatch, _FakeCompletions())

        def boom():
            raise RuntimeError("数据库不可用")

        monkeypatch.setattr(ai_ledger, "SessionLocal", boom)
        resp = client.post("/api/generate", json={"prompt": "设计一个登录页"}, headers=auth_headers)
        assert resp.status_code == 200
        assert resp.json()["fallback"] is False
