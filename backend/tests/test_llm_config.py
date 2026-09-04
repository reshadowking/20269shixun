"""LLM 运行时配置接口测试：保存/脱敏/测试连接/立即生效。"""

import json


class TestLLMConfigApi:
    def test_get_config_masked(self, client, auth_headers):
        resp = client.get("/api/llm-config", headers=auth_headers)
        assert resp.status_code == 200
        body = resp.json()
        assert "llm_api_key" in body
        assert "****" in body["llm_api_key"] or body["llm_api_key"] == ""  # 脱敏或空
        assert "providers" in body
        assert "deepseek" in body["providers"]

    def test_save_and_get_roundtrip(self, client, auth_headers):
        resp = client.post("/api/llm-config", json={
            "llm_base_url": "https://api.example.com/v1",
            "llm_api_key": "sk-test-1234567890",
            "llm_model": "test-model",
            "llm_mode": "real",
        }, headers=auth_headers)
        assert resp.status_code == 200
        body = resp.json()
        assert body["llm_base_url"] == "https://api.example.com/v1"
        assert body["llm_model"] == "test-model"
        assert "1234567890" not in body["llm_api_key"]  # Key 不全文返回
        assert body["llm_api_key"] == "sk-****7890"

    def test_save_persisted_to_disk(self, client, auth_headers, tmp_path):
        # 自包含：先保存，再断言磁盘文件存在且含 Key（文件不入 git，由 .gitignore 保证）
        client.post("/api/llm-config", json={"llm_model": "disk-model", "llm_api_key": "sk-disk-key-1"}, headers=auth_headers)
        from app.llm_runtime import CONFIG_FILE

        assert CONFIG_FILE.exists()
        data = json.loads(CONFIG_FILE.read_text(encoding="utf-8"))
        assert data.get("llm_model") == "disk-model"
        assert data.get("llm_api_key") == "sk-disk-key-1"

    def test_empty_values_do_not_overwrite(self, client, auth_headers):
        client.post("/api/llm-config", json={"llm_base_url": "https://api.example.com/v1"}, headers=auth_headers)
        resp = client.post("/api/llm-config", json={"llm_base_url": ""}, headers=auth_headers)
        assert resp.status_code == 200
        body = resp.json()
        assert body["llm_base_url"] == "https://api.example.com/v1"  # 空值不覆盖

    def test_invalid_fields_rejected(self, client, auth_headers):
        resp = client.post("/api/llm-config", json={"llm_timeout_seconds": 5}, headers=auth_headers)  # < 10
        assert resp.status_code == 422
        resp2 = client.post("/api/llm-config", json={"hack": "x"}, headers=auth_headers)
        assert resp2.status_code == 422  # 无白名单字段

    def test_test_connection_no_key(self, client, auth_headers):
        # 清掉已保存的 Key，验证"未配置 Key"分支
        from app.llm_runtime import CONFIG_FILE, _load_from_disk

        CONFIG_FILE.unlink(missing_ok=True)
        _load_from_disk.cache_clear()
        resp = client.post("/api/llm-config/test", json={"llm_base_url": "https://api.example.com/v1"}, headers=auth_headers)
        assert resp.status_code == 200
        body = resp.json()
        assert body["ok"] is False  # 无 Key 或连接失败均视为不可用

    def test_masked_key_save_ignored(self, client, auth_headers):
        """脱敏 key（含 ****）回写被拒绝：保留磁盘上的真实 Key，其他字段正常保存。"""
        import json as _json

        client.post("/api/llm-config", json={"llm_api_key": "sk-real-key-111", "llm_model": "m1"}, headers=auth_headers)
        resp = client.post("/api/llm-config", json={"llm_api_key": "sk-****2222", "llm_model": "m2"}, headers=auth_headers)
        assert resp.status_code == 200
        body = resp.json()
        assert "2222" not in body["llm_api_key"]  # 响应仍脱敏展示旧真实 Key
        from app.llm_runtime import CONFIG_FILE

        data = _json.loads(CONFIG_FILE.read_text(encoding="utf-8"))
        assert data.get("llm_api_key") == "sk-real-key-111"  # 未被脱敏值覆盖
        assert data.get("llm_model") == "m2"  # 非 key 字段照常保存

    def test_test_connection_not_persist_and_masked_ignored(self, client, auth_headers, monkeypatch):
        """测试连接不落盘；请求中脱敏 key 忽略，仅真实新 key 参与本次测试。"""
        import json as _json

        from openai import APITimeoutError

        client.post("/api/llm-config", json={"llm_api_key": "sk-real-key-777", "llm_model": "m1"}, headers=auth_headers)
        seen: dict = {}

        class _FakeCompletions:
            def create(self, **kwargs):
                raise APITimeoutError("模拟超时")

        class _FakeChat:
            completions = _FakeCompletions()

        class _FakeOpenAI:
            def __init__(self, **kwargs):
                seen.update(kwargs)
                self.chat = _FakeChat()

        monkeypatch.setattr("openai.OpenAI", _FakeOpenAI)
        from app.llm_runtime import CONFIG_FILE

        # 请求带脱敏 key：应被忽略，用已保存的真实 Key 测试
        resp = client.post("/api/llm-config/test", json={"llm_api_key": "sk-****2222"}, headers=auth_headers)
        assert resp.status_code == 200
        assert resp.json()["code"] == "TIMEOUT"
        assert seen["api_key"] == "sk-real-key-777"
        # 磁盘未被请求值污染
        data = _json.loads(CONFIG_FILE.read_text(encoding="utf-8"))
        assert data.get("llm_api_key") == "sk-real-key-777"

        # 请求带真实新 key：参与本次测试，但仍不落盘
        resp2 = client.post("/api/llm-config/test", json={"llm_api_key": "sk-temp-key-888"}, headers=auth_headers)
        assert resp2.status_code == 200
        assert seen["api_key"] == "sk-temp-key-888"
        data2 = _json.loads(CONFIG_FILE.read_text(encoding="utf-8"))
        assert data2.get("llm_api_key") == "sk-real-key-777"


class TestRuntimeTakesPrecedence:
    def test_client_cfg_uses_runtime(self, client, auth_headers):
        """运行时配置优先于 .env：LLMClient.cfg 读取前端保存的值。"""
        client.post("/api/llm-config", json={"llm_base_url": "https://api.example.com/v1", "llm_model": "test-model"}, headers=auth_headers)
        from app.services.llm import LLMClient

        llm = LLMClient()
        assert llm.cfg("llm_base_url") == "https://api.example.com/v1"
        assert llm.cfg("llm_model") == "test-model"
