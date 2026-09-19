"""T50：SDK 客户端必须关闭内部静默重试（重试由 `LLMClient` 统一负责）。

背景：`openai` / `anthropic` 两个 SDK 的 `max_retries` **默认都是 2**，而 `LLMClient`
自己实现了带预算感知的重试链（超时 → 重试 1 次 → 切备用，每步写日志）。SDK 的内部
重试不写日志、不受 `GenerationDeadline` 约束——实测把"45s 全链路预算"放大成 137s。

**行为断言只覆盖已接入的两条构造路径**（openai 族 / anthropic 族）；新增协议族时必须
调用 `with_sdk_defaults`（结构约定，见 docs/T50-待修-SDK静默重试拖垮时间预算.md），
否则超时会被静默放大 3 倍。
"""
from app.services.llm import build_client
from app.services.llm.profiles import get_profile
from app.services.llm.protocols.anthropic_msg import build_anthropic_client
from app.services.llm.sdk_options import with_sdk_defaults


class TestWithSdkDefaults:
    def test_缺省补_max_retries_0(self):
        assert with_sdk_defaults({})["max_retries"] == 0

    def test_已显式传时不覆盖(self):
        assert with_sdk_defaults({"max_retries": 3})["max_retries"] == 3

    def test_返回同一字典_便于内联使用(self):
        kwargs: dict = {"base_url": "x"}
        assert with_sdk_defaults(kwargs) is kwargs


class TestBothClientPaths:
    def test_openai_族_关闭内部重试(self):
        client = build_client(
            get_profile("deepseek"), "chat", api_key="k", base_url="https://api.deepseek.com", timeout=10
        )
        assert client.max_retries == 0

    def test_anthropic_族_关闭内部重试(self):
        client = build_anthropic_client(
            api_key="k", base_url="https://api.moonshot.cn/anthropic", timeout=10, auth="bearer"
        )
        assert client.max_retries == 0
