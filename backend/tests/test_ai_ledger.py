"""T21：AI 调用记账（ai_calls 表）——真实记录、失败留痕、隐私边界、旁路容错。

通过替换 `llm.OpenAI` 造出"真实调用"：这样 `_create` 与记账代码全部真实执行，且零网络。
"""
import logging
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


class TestColumnWidthGuard:
    """2026-09-18 线上暴露：列宽不满足会让**整批**回滚。

    `error_code` 是 varchar(64)，`describe_api_error` 最长约 129 字符；Postgres 抛
    StringDataRightTruncation，而写入是一次 add_all + 一次 commit → 主模型与备用模型
    两条记录全丢。**SQLite 不校验长度**，所以这里必须直接断言截断逻辑本身。
    """

    def test_long_error_code_truncated_and_logged(self, caplog):
        limit = ai_ledger._COLUMN_LIMITS["error_code"]
        long_text = "HTTP 401 " + "x" * 300  # 实测长度 309 > 64
        with caplog.at_level(logging.WARNING):
            fitted = ai_ledger._fit("error_code", long_text)
        assert len(fitted) == limit
        assert fitted == long_text[:limit]
        assert long_text in caplog.text, "被截断的完整内容必须留在日志里，否则没法排查"

    def test_short_value_untouched(self):
        assert ai_ledger._fit("error_code", "HTTP 429 rate limited") == "HTTP 429 rate limited"

    def test_non_string_values_untouched(self):
        assert ai_ledger._fit("tokens_out", 42) == 42
        assert ai_ledger._fit("ok", False) is False

    def test_limits_cover_all_string_columns(self):
        """不变量：**所有字符串列**都能取到列宽（整数/布尔列无需）。

        将来若加一个无长度上限的 `String()` 列，这里会红——提醒要么给它加长度，
        要么显式纳入截断/豁免，而不是静默绕过（绕过就等于"超长时整批回滚"）。
        """
        table = AiCall.__table__
        string_columns = {
            name for name in ai_ledger._FIELDS if hasattr(table.columns[name].type, "length")
        }
        assert string_columns == set(ai_ledger._COLUMN_LIMITS)

    def test_record_calls_fits_values_before_insert(self, monkeypatch):
        """端到端：传给 ORM 的值必须已经 ≤ 列宽（截断发生在写入之前）。"""
        captured: list[dict] = []

        class _Recorder:
            def __init__(self, **kwargs):
                captured.append(kwargs)

        class _Session:
            def add_all(self, rows):
                return None

            def commit(self):
                return None

            def close(self):
                return None

        monkeypatch.setattr(ai_ledger, "AiCall", _Recorder)
        monkeypatch.setattr(ai_ledger, "SessionLocal", lambda: _Session())
        ai_ledger.record_calls(
            [
                {"kind": "fill", "model": "deepseek-flash", "error_code": "y" * 300},
                {"kind": "fill", "model": "deepseek-v4-pro", "error_code": "z" * 300},
            ]
        )
        limit = ai_ledger._COLUMN_LIMITS["error_code"]
        assert len(captured) == 2, "两条记录都要写入（旧实现会因第一条超长而整批回滚）"
        assert all(len(row["error_code"]) == limit for row in captured)
