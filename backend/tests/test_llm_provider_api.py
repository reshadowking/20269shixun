"""T48 供应商预设 / API 格式的接口层测试（含诊断端点）。

覆盖：新字段读写、老档案反推、Mock 模式的三种响应结构、BaseURL 前缀校验、
失败时的排查信息（HTTP 状态码 + 原始 error body + 最终 URL + 实际格式）。
"""
from types import SimpleNamespace

import pytest

from app.config import get_settings


class TestConfigApiNewFields:
    def test_get_config_exposes_format_data_and_validation_rules(self, client, auth_headers):
        body = client.get("/api/llm-config", headers=auth_headers).json()
        # 既有契约不变
        assert "deepseek" in body["providers"]
        # 前端即时校验所需的数据全部由后端下发（前端不持有规则副本）
        assert body["reserved_path_suffixes"] == ["/chat/completions", "/responses", "/messages"]
        assert "路径后缀" in body["reserved_path_message"]
        assert body["api_format_labels"]["anthropic"] == "Anthropic Messages"
        # 预设新字段
        kimi = body["providers"]["kimi"]
        assert kimi["supported_formats"] == ["chat", "responses", "anthropic"]
        assert kimi["final_url_by_format"]["anthropic"] == "https://api.moonshot.cn/anthropic/v1/messages"
        assert kimi["param_policy"]["chat"]["drop"][0] == "temperature"
        assert kimi["hint_by_format"]["chat"].startswith("当前预设会调用")

    def test_legacy_moonshot_alias_kept_but_marked_deprecated(self, client, auth_headers):
        """只增不删：老前端 bundle 读 providers.moonshot 仍能拿到；新前端按 deprecated 跳过。"""
        providers = client.get("/api/llm-config", headers=auth_headers).json()["providers"]
        assert providers["moonshot"]["deprecated"] is True
        assert providers["moonshot"]["base_url"] == "https://api.moonshot.cn/v1"

    def test_save_and_roundtrip_provider_and_format(self, client, auth_headers):
        body = client.post(
            "/api/llm-config",
            json={"llm_provider": "kimi", "llm_api_format": "anthropic", "llm_base_url": "https://api.moonshot.cn/anthropic"},
            headers=auth_headers,
        ).json()
        assert body["llm_provider"] == "kimi"
        assert body["llm_api_format"] == "anthropic"

    def test_legacy_moonshot_provider_id_normalized(self, client, auth_headers):
        body = client.post(
            "/api/llm-config", json={"llm_provider": "moonshot"}, headers=auth_headers
        ).json()
        assert body["llm_provider"] == "kimi"

    def test_unknown_provider_rejected(self, client, auth_headers):
        resp = client.post("/api/llm-config", json={"llm_provider": "not-a-provider"}, headers=auth_headers)
        assert resp.status_code == 422

    def test_unknown_api_format_rejected(self, client, auth_headers):
        resp = client.post("/api/llm-config", json={"llm_api_format": "graphql"}, headers=auth_headers)
        assert resp.status_code == 422


class TestContextHint:
    """失败消息要能一眼看出"哪家的 key 不对"——曾经只有 `HTTP 401 …`，得靠翻配置定位。"""

    def test_hint_names_provider_host_and_format(self, client, auth_headers):
        client.post(
            "/api/llm-config",
            json={
                "llm_provider": "kimi",
                "llm_api_format": "anthropic",
                "llm_base_url": "https://api.moonshot.cn/anthropic",
            },
            headers=auth_headers,
        )
        from app.services.llm import LLMClient

        hint = LLMClient().context_hint()
        assert "Kimi" in hint
        assert "api.moonshot.cn" in hint
        assert "Anthropic Messages" in hint

    def test_hint_without_base_url_says_so(self, client, auth_headers, monkeypatch):
        from app.config import get_settings
        from app.llm_runtime import CONFIG_FILE, _load_from_disk

        CONFIG_FILE.unlink(missing_ok=True)
        _load_from_disk.cache_clear()
        monkeypatch.setattr(get_settings(), "llm_base_url", "")
        from app.services.llm import LLMClient

        assert "未填地址" in LLMClient().context_hint()


class TestLegacyProfileInference:
    def test_legacy_kimi_config_gets_drop_policy(self, client, auth_headers):
        """现网老档案（只有 base_url/model，没有 llm_provider）→ 反推 kimi → 请求体里没有 temperature。

        这是"Kimi temperature 400"线上缺陷的端到端验收点：反推失败的话，
        采样参数剔除策略根本不会生效。
        """
        client.post(
            "/api/llm-config",
            json={
                "llm_base_url": "https://api.moonshot.cn/v1",
                "llm_model": "kimi-k2.7-code",
                "llm_mode": "real",
            },
            headers=auth_headers,
        )
        body = client.get("/api/llm-config", headers=auth_headers).json()
        assert body["llm_provider"] == "kimi"
        assert body["llm_api_format"] == "chat"

        from app.services.llm import LLMClient
        from app.services.llm.dispatcher import resolve

        profile, api_format = LLMClient().target
        assert profile.id == "kimi"
        adapter, effective = resolve(profile, api_format)
        assert effective == "chat"
        plan = adapter.build(
            profile=profile,
            model="kimi-k2.7-code",
            system="S",
            user="U",
            history=None,
            temperature=0.1,
            max_tokens=100,
        )
        assert "temperature" not in plan.kwargs
        assert plan.final_url == "https://api.moonshot.cn/v1/chat/completions"


class TestTestConnection:
    @pytest.mark.parametrize(
        "api_format,shape_key",
        [("chat", "choices"), ("responses", "output"), ("anthropic", "content")],
    )
    def test_mock_mode_returns_format_shaped_payload(self, client, auth_headers, api_format, shape_key):
        """Mock 模式不调远程，按 API 格式返回各自的模拟响应结构。"""
        body = client.post(
            "/api/llm-config/test",
            json={
                "llm_provider": "kimi",
                "llm_api_format": api_format,
                "llm_base_url": "https://api.moonshot.cn/v1",
                "llm_mode": "mock",
            },
            headers=auth_headers,
        ).json()
        assert body["ok"] is True
        assert body["mock"] is True
        assert body["api_format"] == api_format
        assert shape_key in body["raw"]
        assert body["final_url"]

    def test_invalid_base_url_rejected_before_any_request(self, client, auth_headers):
        body = client.post(
            "/api/llm-config/test",
            json={
                "llm_base_url": "https://api.deepseek.com/chat/completions",
                "llm_provider": "deepseek",
                "llm_api_format": "chat",
            },
            headers=auth_headers,
        ).json()
        assert body["ok"] is False
        assert body["code"] == "INVALID_BASE_URL"
        assert "BaseURL 不应包含路径后缀" in body["error"]

    def test_custom_preset_without_base_url(self, client, auth_headers, monkeypatch):
        from app.llm_runtime import CONFIG_FILE, _load_from_disk

        CONFIG_FILE.unlink(missing_ok=True)
        _load_from_disk.cache_clear()
        monkeypatch.setattr(get_settings(), "llm_base_url", "")
        body = client.post(
            "/api/llm-config/test", json={"llm_provider": "custom"}, headers=auth_headers
        ).json()
        assert body["ok"] is False
        assert body["code"] == "NO_BASE_URL"

    def test_failure_returns_status_raw_body_and_final_url(self, client, auth_headers, monkeypatch):
        """失败时必须给出可排查的全部信息：状态码 + 原始 error body + 最终 URL + 实际格式。"""
        import httpx

        raw_body = '{"error":{"message":"Authentication Fails, Your api key: ****rmat is invalid"}}'
        request = httpx.Request("POST", "https://api.deepseek.com/chat/completions")
        # APIStatusError 的构造会读 response.headers/status_code，所以用真实 Response
        response = httpx.Response(401, request=request, text=raw_body)

        class _FakeOpenAI:
            def __init__(self, **_kwargs):
                self.chat = SimpleNamespace(completions=SimpleNamespace(create=self._create))

            def _create(self, **_kwargs):
                from openai import APIStatusError

                raise APIStatusError("401 Authentication Fails", response=response, body=None)

        monkeypatch.setattr("openai.OpenAI", _FakeOpenAI)
        client.post(
            "/api/llm-config",
            json={
                "llm_mode": "real",
                "llm_api_key": "sk-x",
                "llm_provider": "deepseek",
                "llm_api_format": "chat",
                "llm_base_url": "https://api.deepseek.com",
            },
            headers=auth_headers,
        )
        body = client.post("/api/llm-config/test", json={}, headers=auth_headers).json()
        assert body["ok"] is False
        assert body["status"] == 401
        assert body["body"] == raw_body
        assert body["final_url"] == "https://api.deepseek.com/chat/completions"
        assert body["api_format"] == "chat"

    def test_error_detail_extracts_status_and_body(self):
        from app.routers.llm_config import _error_detail

        exc = RuntimeError("boom")
        exc.response = SimpleNamespace(status_code=429, text='{"error":"rate limited"}')  # type: ignore[attr-defined]
        assert _error_detail(exc) == (429, '{"error":"rate limited"}')

    def test_error_detail_falls_back_to_str(self):
        from app.routers.llm_config import _error_detail

        assert _error_detail(RuntimeError("no response here")) == (None, "no response here")
