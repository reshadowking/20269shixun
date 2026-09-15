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
        # T34：文件改为"档案"结构——断言当前生效档案里的字段（旧扁平结构会被自动迁移到 default 档案）
        active = next(p for p in data["profiles"] if p["id"] == data["active"])
        assert active.get("llm_model") == "disk-model"
        assert active.get("llm_api_key") == "sk-disk-key-1"

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
        active = next(p for p in data["profiles"] if p["id"] == data["active"])
        assert active.get("llm_api_key") == "sk-real-key-111"  # 未被脱敏值覆盖
        assert active.get("llm_model") == "m2"  # 非 key 字段照常保存

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
        active = next(p for p in data["profiles"] if p["id"] == data["active"])
        assert active.get("llm_api_key") == "sk-real-key-777"

        # 请求带真实新 key：参与本次测试，但仍不落盘
        resp2 = client.post("/api/llm-config/test", json={"llm_api_key": "sk-temp-key-888"}, headers=auth_headers)
        assert resp2.status_code == 200
        assert seen["api_key"] == "sk-temp-key-888"
        data2 = _json.loads(CONFIG_FILE.read_text(encoding="utf-8"))
        active2 = next(p for p in data2["profiles"] if p["id"] == data2["active"])
        assert active2.get("llm_api_key") == "sk-real-key-777"


class TestRuntimeTakesPrecedence:
    def test_client_cfg_uses_runtime(self, client, auth_headers):
        """运行时配置优先于 .env：LLMClient.cfg 读取前端保存的值。"""
        client.post("/api/llm-config", json={"llm_base_url": "https://api.example.com/v1", "llm_model": "test-model"}, headers=auth_headers)
        from app.services.llm import LLMClient

        llm = LLMClient()
        assert llm.cfg("llm_base_url") == "https://api.example.com/v1"
        assert llm.cfg("llm_model") == "test-model"


class TestTestIsolationSafety:
    """事故回归（2026-09-10）：全量 pytest 曾把开发者保存的 LLM 运行时配置删掉。"""

    def test_runtime_config_path_is_redirected_in_tests(self):
        from app import llm_runtime

        # 测试期必须指向临时目录，而不是 backend/data/llm-config.json
        assert llm_runtime.CONFIG_FILE.name == "llm-config.json"
        assert "llm-runtime" in str(llm_runtime.CONFIG_FILE), (
            f"测试期配置路径未重定向到临时目录：{llm_runtime.CONFIG_FILE}（会造成开发者配置被删）"
        )
        assert llm_runtime.CONFIG_FILE.parent != llm_runtime.DATA_DIR

    def test_saving_runtime_config_does_not_touch_dev_file(self, client, auth_headers):
        """保存运行时配置只写测试临时文件；开发者真实配置路径不受影响。"""
        from app import llm_runtime

        before = llm_runtime.CONFIG_FILE.exists()
        resp = client.post(
            "/api/llm-config",
            json={"llm_base_url": "https://example.invalid/v1", "llm_api_key": "sk-test-not-real"},
            headers=auth_headers,
        )
        assert resp.status_code == 200
        real = llm_runtime.DATA_DIR / "llm-config.json"
        # 真实路径要么不存在、要么未被这次测试改写（存在时内容不含测试值）
        if real.exists():
            assert "example.invalid" not in real.read_text(encoding="utf-8")
        assert llm_runtime.CONFIG_FILE != real
        assert llm_runtime.CONFIG_FILE.exists() or not before


class TestConfigFileEnvOverride:
    def test_env_var_overrides_config_file(self):
        """T10.2：LLM_CONFIG_FILE 环境变量可覆盖配置文件路径——测试/演练模式不再依赖
        「启动包装器改模块常量」。用子进程验证（不 reload 当前进程，避免破坏 conftest
        的会话级隔离）。"""
        import os
        import subprocess
        import sys
        from pathlib import Path

        backend = Path(__file__).resolve().parent.parent
        env = {**os.environ, "LLM_CONFIG_FILE": "_t10_2_override/probe.json"}
        out = subprocess.run(
            [sys.executable, "-c", "from app import llm_runtime; print(llm_runtime.CONFIG_FILE)"],
            cwd=backend, env=env, capture_output=True, text=True, timeout=60, check=False,
        )
        assert out.returncode == 0, out.stderr
        assert Path(out.stdout.strip()).as_posix().endswith("_t10_2_override/probe.json"), out.stdout

    def test_default_path_when_env_absent(self):
        """未设置环境变量时维持默认路径 backend/data/llm-config.json。"""
        import os
        import subprocess
        import sys
        from pathlib import Path

        backend = Path(__file__).resolve().parent.parent
        env = {k: v for k, v in os.environ.items() if k != "LLM_CONFIG_FILE"}
        out = subprocess.run(
            [sys.executable, "-c", "from app import llm_runtime; print(llm_runtime.CONFIG_FILE)"],
            cwd=backend, env=env, capture_output=True, text=True, timeout=60, check=False,
        )
        assert out.returncode == 0, out.stderr
        assert Path(out.stdout.strip()).as_posix().endswith("data/llm-config.json"), out.stdout
