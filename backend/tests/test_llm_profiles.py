"""T34：命名档案（多接口互不覆盖 + 切换即生效 + 旧扁平配置自动迁移 + Key 脱敏）。"""

from app.llm_runtime import get_runtime_config, list_profiles


def _profiles(client, headers) -> dict:
    resp = client.get("/api/llm-config/profiles", headers=headers)
    assert resp.status_code == 200
    return resp.json()


class TestProfileMigration:
    def test_legacy_flat_config_becomes_default_profile(self, client, auth_headers):
        """旧扁平配置读取后自动包装为 default 档案，且扁平读取契约不变。"""
        client.post(
            "/api/llm-config",
            json={"llm_base_url": "https://api.deepseek.com/v1", "llm_model": "deepseek-chat"},
            headers=auth_headers,
        )
        data = _profiles(client, auth_headers)
        assert data["active"]
        assert data["profiles"]
        assert get_runtime_config()["llm_model"] == "deepseek-chat"


class TestNamedProfiles:
    def test_create_second_profile_does_not_contaminate_first(self, client, auth_headers):
        client.post(
            "/api/llm-config/profiles",
            json={"id": "ds", "name": "DeepSeek", "llm_base_url": "https://api.deepseek.com/v1", "llm_model": "deepseek-chat"},
            headers=auth_headers,
        )
        client.post(
            "/api/llm-config/profiles",
            json={"id": "qwen", "name": "通义千问", "llm_base_url": "https://dashscope.aliyuncs.com/compatible-mode/v1", "llm_model": "qwen-plus"},
            headers=auth_headers,
        )
        data = _profiles(client, auth_headers)
        by_id = {p["id"]: p for p in data["profiles"]}
        assert by_id["ds"]["llm_model"] == "deepseek-chat"
        assert by_id["qwen"]["llm_model"] == "qwen-plus"
        assert data["active"] == "qwen"
        assert get_runtime_config()["llm_model"] == "qwen-plus"

    def test_switch_profile_changes_effective_config_only(self, client, auth_headers):
        client.post("/api/llm-config/profiles", json={"id": "pa", "name": "A", "llm_model": "model-a"}, headers=auth_headers)
        client.post("/api/llm-config/profiles", json={"id": "pb", "name": "B", "llm_model": "model-b"}, headers=auth_headers)
        assert client.post("/api/llm-config/profiles/pa/activate", headers=auth_headers).status_code == 200
        assert get_runtime_config()["llm_model"] == "model-a"
        client.post("/api/llm-config/profiles/pb/activate", headers=auth_headers)
        client.post("/api/llm-config/profiles/pa/activate", headers=auth_headers)
        assert get_runtime_config()["llm_model"] == "model-a"

    def test_api_key_is_masked_in_list(self, client, auth_headers):
        client.post(
            "/api/llm-config/profiles",
            json={"id": "k", "name": "带 Key", "llm_api_key": "sk-secret-1234", "llm_model": "m"},
            headers=auth_headers,
        )
        data = _profiles(client, auth_headers)
        target = next(p for p in data["profiles"] if p["id"] == "k")
        assert "****" in target["llm_api_key"]
        assert "secret" not in target["llm_api_key"]

    def test_delete_profile_keeps_at_least_one(self, client, auth_headers):
        """默认档案始终存在：删掉自己新建的档案后仍保留一个；删最后一个会被拒绝。"""
        client.post("/api/llm-config/profiles", json={"id": "only", "name": "唯一"}, headers=auth_headers)
        assert client.delete("/api/llm-config/profiles/only", headers=auth_headers).status_code == 200
        remaining = _profiles(client, auth_headers)["profiles"]
        assert len(remaining) == 1
        last_id = remaining[0]["id"]
        assert client.delete(f"/api/llm-config/profiles/{last_id}", headers=auth_headers).status_code == 404

    def test_activate_unknown_profile_404(self, client, auth_headers):
        assert client.post("/api/llm-config/profiles/nope/activate", headers=auth_headers).status_code == 404

    def test_active_profile_shows_in_flat_config(self, client, auth_headers):
        client.post(
            "/api/llm-config/profiles",
            json={"id": "flat", "name": "F", "llm_model": "flat-model", "llm_base_url": "https://x/v1"},
            headers=auth_headers,
        )
        resp = client.get("/api/llm-config", headers=auth_headers)
        assert resp.status_code == 200
        assert resp.json()["llm_model"] == "flat-model"
        assert list_profiles()["active"] == "flat"
