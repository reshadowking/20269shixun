"""T20：AI 生成网关——专用池隔离 / 并发闸门 / 整链路时间预算。

隔离的判别点不是"延迟数字"（同机小并发下 anyio 池有 40 个槽，延迟断言不具判别力），
而是**生成确实跑在 ai-gen 专用线程、而不是 anyio 的同步路由线程**。
"""
import json
import threading
import time
from concurrent.futures import ThreadPoolExecutor

import pytest

from app.config import get_settings
from app.services import ai_gateway
from app.services.ai_gateway import GenerationDeadline
from app.services.generate import GenerateResult
from app.services.templates import TEMPLATES


@pytest.fixture(autouse=True)
def _reset_gateway():
    """池与信号量是模块级单例：改了 llm_max_concurrency 的用例必须前后重置。"""
    ai_gateway._reset_for_tests()
    yield
    ai_gateway._reset_for_tests()


def _result() -> GenerateResult:
    return GenerateResult(design=TEMPLATES["login"], template="login", compliance=100.0, violations=0, style_attrs=0)


def _patch_generate(monkeypatch, fn) -> None:
    from app.routers import generate as generate_router

    monkeypatch.setattr(generate_router, "generate_design", fn)


class TestDedicatedPool:
    def test_generation_runs_in_dedicated_pool(self, client, auth_headers, monkeypatch):
        seen = {}

        def fake(*args, **kwargs):
            seen["thread"] = threading.current_thread().name
            return _result()

        _patch_generate(monkeypatch, fake)
        resp = client.post("/api/generate", json={"prompt": "设计一个登录页"}, headers=auth_headers)
        assert resp.status_code == 200
        assert seen["thread"].startswith("ai-gen"), f"生成未跑在专用池：{seen['thread']}"
        assert get_settings().llm_max_concurrency >= 2  # explore 需要 2 个槽位才能并行

    def test_canvas_routes_stay_fast_while_generating(self, client, auth_headers, monkeypatch):
        """4 路生成阻塞期间，画布基础接口仍在 300ms 内返回（实测值打日志）。"""
        release = threading.Event()
        entered: list[int] = []
        lock = threading.Lock()

        def fake(*args, **kwargs):
            with lock:
                entered.append(1)
            release.wait(timeout=5)
            return _result()

        _patch_generate(monkeypatch, fake)
        with ThreadPoolExecutor(max_workers=4) as pool:
            futures = [
                pool.submit(client.post, "/api/generate", json={"prompt": "设计一个登录页"}, headers=auth_headers)
                for _ in range(4)
            ]
            limit = time.time() + 5
            while len(entered) < 2 and time.time() < limit:
                time.sleep(0.02)

            t0 = time.perf_counter()
            health = client.get("/api/health")
            health_ms = (time.perf_counter() - t0) * 1000
            t1 = time.perf_counter()
            designs = client.get("/api/designs", headers=auth_headers)
            designs_ms = (time.perf_counter() - t1) * 1000
            release.set()
            codes = [f.result(timeout=15).status_code for f in futures]

        print(f"[T20] 生成期间 /api/health={health_ms:.1f}ms /api/designs={designs_ms:.1f}ms")
        assert health.status_code == 200 and designs.status_code == 200
        assert codes == [200, 200, 200, 200]
        assert health_ms < 300 and designs_ms < 300

    def test_queue_timeout_returns_503(self, client, auth_headers, monkeypatch):
        settings = get_settings()
        monkeypatch.setattr(settings, "llm_max_concurrency", 1)
        monkeypatch.setattr(settings, "llm_queue_timeout_seconds", 0.1)
        ai_gateway._reset_for_tests()

        release = threading.Event()
        entered = threading.Event()

        def fake(*args, **kwargs):
            entered.set()
            release.wait(timeout=5)
            return _result()

        _patch_generate(monkeypatch, fake)
        with ThreadPoolExecutor(max_workers=1) as pool:
            first = pool.submit(client.post, "/api/generate", json={"prompt": "设计一个登录页"}, headers=auth_headers)
            assert entered.wait(timeout=5)
            second = client.post("/api/generate", json={"prompt": "设计一个登录页"}, headers=auth_headers)
            release.set()
            assert first.result(timeout=15).status_code == 200

        assert second.status_code == 503
        assert "稍后重试" in second.json()["detail"]

    def test_explore_runs_variants_in_parallel(self, client, auth_headers, monkeypatch):
        def slow(*args, **kwargs):
            time.sleep(0.4)
            return _result()

        _patch_generate(monkeypatch, slow)
        t0 = time.perf_counter()
        resp = client.post("/api/generate/explore", json={"prompt": "设计一个登录页"}, headers=auth_headers)
        elapsed = time.perf_counter() - t0
        assert resp.status_code == 200
        assert len(resp.json()["options"]) == 2
        assert elapsed < 0.7, f"两方案未并行（总耗时 {elapsed:.2f}s）"


class TestDeadline:
    def test_countdown_and_expiry(self):
        deadline = GenerationDeadline(0.05)
        assert deadline.remaining() > 0 and not deadline.expired()
        time.sleep(0.06)
        assert deadline.expired()

    def test_budget_exhausted_skips_further_calls(self, client, auth_headers, monkeypatch):
        """第一次调用把预算吃光 → 填充阶段不再发起调用，直接兜底并给出可读原因。"""
        from app.services import llm as llm_module

        settings = get_settings()
        monkeypatch.setattr(settings, "llm_deadline_seconds", 0.3)
        monkeypatch.setattr(settings, "llm_min_call_budget_seconds", 0.0)  # 允许发起第一次调用
        calls: list[str] = []

        def slow_real_chat(self, system, user, temperature, history=None, deadline=None):
            calls.append(system[:12])
            time.sleep(0.4)  # 吃掉全部预算
            return json.dumps(
                {"template": "login", "theme": "default", "components": [], "copy_intent": "", "style_intent": "", "tone": ""},
                ensure_ascii=False,
            )

        monkeypatch.setattr(llm_module.LLMClient, "is_mock", property(lambda self: False))
        monkeypatch.setattr(llm_module.LLMClient, "_real_chat", slow_real_chat)

        resp = client.post("/api/generate", json={"prompt": "设计一个登录页"}, headers=auth_headers)
        assert resp.status_code == 200
        body = resp.json()
        assert len(calls) == 1, f"预算耗尽后仍发起了调用：{calls}"
        assert body["fallback"] is True
        assert "生成时间预算" in body["error"]


class TestMockRegression:
    def test_mock_mode_still_returns_template(self, client, auth_headers):
        resp = client.post("/api/generate", json={"prompt": "设计一个登录页"}, headers=auth_headers)
        assert resp.status_code == 200
        body = resp.json()
        assert body["mock"] is True
        assert body["fallback"] is False
        assert body["design"]["id"]
