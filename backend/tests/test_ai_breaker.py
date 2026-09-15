"""T22：熔断器（连续失败/失败率触发、半开恢复、mock 不计入）。"""
from types import SimpleNamespace

import pytest

from app.config import get_settings
from app.services import ai_breaker
from app.services.generate import generate_design
from app.services.llm import LLMClient


@pytest.fixture(autouse=True)
def _reset():
    ai_breaker._reset_for_tests()
    yield
    ai_breaker._reset_for_tests()


CALLS: list[int] = []


def _real_mode(monkeypatch, fail: bool) -> list[int]:
    """零网络模拟真实模型：替换 `llm.OpenAI`，让 `_create`（含记账）真实执行。"""
    from app.services import llm as llm_module

    CALLS.clear()

    class FakeCompletions:
        def create(self, **kwargs):
            CALLS.append(1)
            if fail:
                raise RuntimeError("模拟模型不可用")
            return SimpleNamespace(
                model="fake-model",
                usage=None,
                choices=[
                    SimpleNamespace(
                        message=SimpleNamespace(content='{"id":"breaker-root","type":"frame","children":[]}'),
                        finish_reason="stop",
                    )
                ],
            )

    class FakeOpenAI:
        def __init__(self, **_kwargs):
            self.chat = SimpleNamespace(completions=FakeCompletions())

    monkeypatch.setattr(llm_module, "OpenAI", FakeOpenAI)
    monkeypatch.setattr(llm_module.LLMClient, "is_mock", property(lambda self: False))
    return CALLS


class TestBreaker:
    def test_opens_after_consecutive_failures(self, monkeypatch):
        seen = _real_mode(monkeypatch, fail=True)
        for _ in range(5):
            generate_design("设计一个登录页", LLMClient())
        assert seen, "至少应发生过调用"
        assert ai_breaker.state() == "open"
        before = len(seen)
        result = generate_design("设计一个登录页", LLMClient())
        assert len(seen) == before, "熔断打开后不应再调用模型"
        assert result.fallback is True
        assert "AI 服务暂时不可用" in result.error

    def test_half_open_recovers(self, monkeypatch):
        monkeypatch.setattr(get_settings(), "ai_breaker_open_seconds", 0.05)
        _real_mode(monkeypatch, fail=True)
        for _ in range(5):
            generate_design("设计一个登录页", LLMClient())
        assert ai_breaker.state() == "open"
        import time

        time.sleep(0.06)
        assert ai_breaker.is_open() is False  # 放行一次探测
        _real_mode(monkeypatch, fail=False)
        result = generate_design("设计一个登录页", LLMClient())
        assert result.fallback is False
        assert ai_breaker.state() == "closed"

    def test_mock_mode_not_counted(self):
        for _ in range(10):
            generate_design("设计一个登录页", LLMClient(mock_responder=lambda s, u: ""))
        assert ai_breaker.state() == "closed"
