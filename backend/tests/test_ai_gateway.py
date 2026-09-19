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

    def test_backup_and_retry_never_exceed_remaining_budget(self, monkeypatch):
        """重试 / 备用模型都不得超出剩余预算（2026-09-17 修）。

        实测（改前）：预算 8s → 三次尝试的超时分别是 [8.0, 8.0, **30.0**]（备用那步固定 30s），
        最坏总耗时约 46s，与 ai_gateway 的"整条链路时间预算"口径矛盾，也会打破 ≤30s 的指标。
        """
        from openai import APITimeoutError

        from app.services.llm import LLMClient

        client = LLMClient()
        client.runtime = {"llm_mode": "real", "llm_api_key": "sk-test", "llm_timeout_seconds": 60.0}
        attempts: list[tuple[str, float]] = []

        def always_timeout(_client, model, system, user, temperature, history=None, kind=""):
            attempts.append((model, float(_client.timeout)))
            raise APITimeoutError(request=None)  # type: ignore[arg-type]

        monkeypatch.setattr(client, "_create", always_timeout)
        deadline = GenerationDeadline(8.0)
        with pytest.raises(APITimeoutError):
            client._real_chat("sys", "user", 0.5, deadline=deadline)

        assert attempts, "应当至少尝试过主模型"
        assert all(t <= 8.5 for _, t in attempts), f"有尝试超出剩余预算：{attempts}"

    def test_expired_budget_skips_backup_entirely(self, monkeypatch):
        """主模型失败时若预算已被吃光 → 连备用都不发（抛 LLMDeadlineExceeded，交上层兜底）。

        这是 2026-09-17 新增 `_raise_if_expired` 的直接验收点：改前会照样发起 30s 的备用请求。
        """
        from openai import APIStatusError

        from app.services.llm import LLMClient, LLMDeadlineExceeded

        client = LLMClient()
        client.runtime = {"llm_mode": "real", "llm_api_key": "sk-test", "llm_timeout_seconds": 60.0}
        calls: list[str] = []

        def fail_main(_client, model, system, user, temperature, history=None, kind="", **kwargs):
            calls.append(model)
            time.sleep(0.25)  # 把 0.2s 的预算吃光后再失败
            raise APIStatusError("boom", response=type("R", (), {"status_code": 500, "request": None})(), body=None)

        monkeypatch.setattr(client, "_create", fail_main)
        deadline = GenerationDeadline(0.2)
        with pytest.raises(LLMDeadlineExceeded):
            client._real_chat("sys", "user", 0.5, deadline=deadline)
        assert calls == [get_settings().llm_model], f"耗尽预算后不应再发起备用调用：{calls}"

    def test_budget_exhausted_skips_further_calls(self, client, auth_headers, monkeypatch):
        """第一次调用把预算吃光 → 填充阶段不再发起调用，直接兜底并给出可读原因。"""
        from app.services import llm as llm_module

        settings = get_settings()
        monkeypatch.setattr(settings, "llm_deadline_seconds", 0.3)
        monkeypatch.setattr(settings, "llm_min_call_budget_seconds", 0.0)  # 允许发起第一次调用
        calls: list[str] = []

        def slow_real_chat(self, system, user, temperature, history=None, deadline=None, **_kwargs):
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
