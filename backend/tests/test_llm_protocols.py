"""T48 协议族表驱动测试：用**真实 SDK** 打到 `httpx.MockTransport`（零网络）。

每个 (预设 × 格式) 组合都断言四件事：

1. **SDK 实际发出的 URL** —— 双断言：既等于硬编码期望表，也等于 profile 的派生值。
   只比派生值是自洽检查（两处同错会一起绿），必须有一份"不在我们代码里"的正确答案。
2. **认证头** —— x-api-key 还是 Authorization: Bearer，完全由 profile 数据决定。
3. **请求体** —— system 位置 / max token 字段名 / temperature 是否被 drop 或 clamp。
4. **响应解析** —— 回灌三种真实响应形状，验证归一化器。

注意 SDK 的 HTTP 栈不同：openai 用 `httpx`，anthropic 用 `httpx2`（实测），
所以注入的 MockTransport 也各用各的。

期望表每行标注来源；曾是 # VERIFY 的两行（DeepSeek 的 /responses 与 /anthropic）已用
官方文档裁定（见任务卡 §步骤 0）。
"""
import json

import httpx
import httpx2
import pytest

from app.services.llm import build_client
from app.services.llm.dispatcher import resolve
from app.services.llm.profiles import PROFILES, get_profile
from app.services.llm.protocols.base import resolve_method
from app.services.llm.url_builder import derive_final_url

TEST_KEY = "sk-test-key"
TEST_MODEL = "test-model"
TEST_SYSTEM = "SYS"
TEST_USER = "USER"
TEST_HISTORY = [{"role": "user", "content": "H1"}, {"role": "assistant", "content": "H2"}]
TEST_TEMPERATURE = 1.5
TEST_MAX_TOKENS = 1234
CUSTOM_BASE = "https://example.com/v1"

COMBINATIONS = sorted(
    (profile_id, api_format)
    for profile_id, profile in PROFILES.items()
    for api_format in profile.supported_formats
)

# 硬编码期望表（来源：DeepSeek 官方 /guides/responses_api 与 /guides/anthropic_api、
# Moonshot 既有端点、DashScope 兼容端点；custom 行参数化到测试 base）
EXPECTED_URLS = {
    ("deepseek", "chat"): "https://api.deepseek.com/chat/completions",
    ("deepseek", "responses"): "https://api.deepseek.com/responses",
    ("deepseek", "anthropic"): "https://api.deepseek.com/anthropic/v1/messages",
    ("kimi", "chat"): "https://api.moonshot.cn/v1/chat/completions",
    ("kimi", "responses"): "https://api.moonshot.cn/v1/responses",
    ("kimi", "anthropic"): "https://api.moonshot.cn/anthropic/v1/messages",
    ("qwen", "chat"): "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
    ("custom", "chat"): f"{CUSTOM_BASE}/chat/completions",
    ("custom", "responses"): f"{CUSTOM_BASE}/responses",
    ("custom", "anthropic"): f"{CUSTOM_BASE}/v1/messages",
}

# 期望的 temperature（None = 请求体里不该出现）
EXPECTED_TEMPERATURE = {
    ("deepseek", "chat"): TEST_TEMPERATURE,  # 协议内置 0~2
    ("deepseek", "responses"): TEST_TEMPERATURE,
    ("deepseek", "anthropic"): TEST_TEMPERATURE,  # 厂商覆盖为 0~2（官方文档）
    ("kimi", "chat"): None,  # 厂商 drop
    ("kimi", "responses"): None,
    ("kimi", "anthropic"): None,
    ("qwen", "chat"): TEST_TEMPERATURE,
    ("custom", "chat"): TEST_TEMPERATURE,
    ("custom", "responses"): TEST_TEMPERATURE,
    ("custom", "anthropic"): 1.0,  # 协议内置 0~1 → 1.5 被夹到 1.0
}

CHAT_REPLY = {
    "id": "chatcmpl-1",
    "object": "chat.completion",
    "created": 1700000000,
    "model": TEST_MODEL,
    "choices": [
        {"index": 0, "message": {"role": "assistant", "content": "OK"}, "finish_reason": "stop"}
    ],
    "usage": {"prompt_tokens": 3, "completion_tokens": 5, "total_tokens": 8},
}

RESPONSES_REPLY = {
    "id": "resp_1",
    "object": "response",
    "created_at": 1700000000,
    "status": "completed",
    "model": TEST_MODEL,
    "error": None,
    "incomplete_details": None,
    "instructions": TEST_SYSTEM,
    "metadata": {},
    "output": [
        {
            "type": "message",
            "id": "msg_1",
            "status": "completed",
            "role": "assistant",
            "content": [{"type": "output_text", "text": "OK", "annotations": []}],
        }
    ],
    "parallel_tool_calls": True,
    "temperature": 1.0,
    "tool_choice": "auto",
    "tools": [],
    "top_p": 1.0,
    "max_output_tokens": TEST_MAX_TOKENS,
    "previous_response_id": None,
    "reasoning": None,
    "text": None,
    "truncation": "disabled",
    "usage": {"input_tokens": 3, "output_tokens": 5, "total_tokens": 8},
}

ANTHROPIC_REPLY = {
    "id": "msg_1",
    "type": "message",
    "role": "assistant",
    "model": TEST_MODEL,
    "content": [{"type": "text", "text": "OK"}],
    "stop_reason": "end_turn",
    "stop_sequence": None,
    "usage": {"input_tokens": 3, "output_tokens": 5},
}

REPLY_BY_FORMAT = {
    "chat": CHAT_REPLY,
    "responses": RESPONSES_REPLY,
    "anthropic": ANTHROPIC_REPLY,
}


class Call:
    """一次真实 SDK 调用的产物（请求被 MockTransport 截获并记录）。"""

    def __init__(self, profile, effective, plan, request, reply):
        self.profile = profile
        self.effective = effective
        self.plan = plan
        self.url = request["url"]
        self.headers = request["headers"]
        self.body = request["body"]
        self.reply = reply

    @property
    def base_url(self) -> str:
        return self.profile.base_url(self.effective) or CUSTOM_BASE


def do_call(
    profile_id: str,
    api_format: str,
    *,
    temperature: float | None = TEST_TEMPERATURE,
    max_tokens: int | None = TEST_MAX_TOKENS,
) -> Call:
    """走完整链路：dispatcher 选 adapter → build_client → SDK 真发请求（被截获）。"""
    profile = get_profile(profile_id)
    adapter, effective = resolve(profile, api_format)
    base_url = profile.base_url(effective) or CUSTOM_BASE
    transport_lib = httpx2 if effective == "anthropic" else httpx
    captured: dict = {}

    def handler(request):
        captured["url"] = str(request.url)
        captured["headers"] = {k.lower(): v for k, v in request.headers.items()}
        captured["body"] = json.loads(request.content.decode("utf-8"))
        return transport_lib.Response(200, json=REPLY_BY_FORMAT[effective])

    client = build_client(
        profile,
        effective,
        api_key=TEST_KEY,
        base_url=base_url,
        timeout=30.0,
        http_client=transport_lib.Client(transport=transport_lib.MockTransport(handler)),
    )
    plan = adapter.build(
        profile=profile,
        model=TEST_MODEL,
        system=TEST_SYSTEM,
        user=TEST_USER,
        history=TEST_HISTORY,
        temperature=temperature,
        max_tokens=max_tokens,
    )
    raw = resolve_method(client, plan.method)(**plan.kwargs)
    return Call(profile, effective, plan, captured, adapter.parse(raw))


class TestExpectedTables:
    def test_tables_cover_every_combination(self):
        """反向护栏：期望表键集合 == 数据展开集合（新增预设/格式必须同步更新期望表）。"""
        assert set(EXPECTED_URLS) == set(COMBINATIONS)
        assert set(EXPECTED_TEMPERATURE) == set(COMBINATIONS)


@pytest.mark.parametrize("profile_id,api_format", COMBINATIONS)
def test_sdk_actual_url_matches_expectation(profile_id, api_format):
    """双断言：SDK 实际 URL == 硬编码期望值，且 profile 派生值 == 同一个期望值。"""
    call = do_call(profile_id, api_format)
    expected = EXPECTED_URLS[(profile_id, api_format)]
    assert call.url == expected
    assert derive_final_url(call.base_url, call.profile.path_suffix(call.effective)) == expected
    assert call.plan.final_url == call.profile.final_url(call.effective)


@pytest.mark.parametrize("profile_id,api_format", COMBINATIONS)
def test_auth_headers_follow_profile(profile_id, api_format):
    call = do_call(profile_id, api_format)
    auth = call.profile.auth(api_format)
    assert call.headers.get("authorization") == (f"Bearer {TEST_KEY}" if auth == "bearer" else None)
    assert call.headers.get("x-api-key") == (TEST_KEY if auth == "anthropic" else None)
    # 交给 SDK 的头里不能有 None（合并必须在我们这层做完）
    assert all(value is not None for value in call.headers.values())
    if api_format == "anthropic":
        # 实测：anthropic SDK 总会下发 anthropic-version，profile 覆盖不掉它
        assert call.headers.get("anthropic-version")
    else:
        assert call.headers.get("anthropic-version") is None


@pytest.mark.parametrize("profile_id,api_format", COMBINATIONS)
def test_temperature_follows_two_dimensional_policy(profile_id, api_format):
    call = do_call(profile_id, api_format)
    expected = EXPECTED_TEMPERATURE[(profile_id, api_format)]
    if expected is None:
        assert "temperature" not in call.body
    else:
        assert call.body["temperature"] == expected


@pytest.mark.parametrize("profile_id,api_format", COMBINATIONS)
def test_system_placement_and_max_tokens_field(profile_id, api_format):
    call = do_call(profile_id, api_format)
    body = call.body
    if api_format == "chat":
        assert body["messages"][0] == {"role": "system", "content": TEST_SYSTEM}
        assert body["messages"][-1] == {"role": "user", "content": TEST_USER}
        assert body["messages"][1:3] == TEST_HISTORY
        assert body["max_tokens"] == TEST_MAX_TOKENS
        assert "input" not in body and "instructions" not in body
    elif api_format == "responses":
        # 不是 messages：系统指令在 instructions，对话在 input
        assert body["instructions"] == TEST_SYSTEM
        assert "messages" not in body
        assert body["input"] == [*TEST_HISTORY, {"role": "user", "content": TEST_USER}]
        assert body["max_output_tokens"] == TEST_MAX_TOKENS
        assert "max_tokens" not in body
    else:
        # system 是独立字段（不是 messages 里的 role），max_tokens 必填
        assert body["system"] == TEST_SYSTEM
        assert body["max_tokens"] == TEST_MAX_TOKENS
        assert [m["role"] for m in body["messages"]] == ["user", "assistant", "user"]
        assert "max_output_tokens" not in body


@pytest.mark.parametrize("profile_id,api_format", COMBINATIONS)
def test_reply_parsed_from_real_sdk(profile_id, api_format):
    call = do_call(profile_id, api_format)
    assert call.reply.text == "OK"
    assert call.reply.model == TEST_MODEL
    assert call.reply.tokens_in == 3
    assert call.reply.tokens_out == 5


class TestAcceptanceCriteria:
    """验收项逐条命名（与任务卡 §六 一一对应）。"""

    def test_kimi_anthropic_body_has_no_temperature_or_top_p(self):
        call = do_call("kimi", "anthropic")
        assert "temperature" not in call.body
        assert "top_p" not in call.body
        assert "presence_penalty" not in call.body
        assert "frequency_penalty" not in call.body

    def test_deepseek_chat_body_has_temperature(self):
        assert do_call("deepseek", "chat").body["temperature"] == TEST_TEMPERATURE

    def test_deepseek_anthropic_uses_x_api_key(self):
        call = do_call("deepseek", "anthropic")
        assert call.headers["x-api-key"] == TEST_KEY
        assert "authorization" not in call.headers

    def test_kimi_anthropic_uses_bearer_not_x_api_key(self):
        """Kimi 的 anthropic 端点用 Bearer —— 靠 profile 数据表达，没有厂商分支。"""
        call = do_call("kimi", "anthropic")
        assert call.headers["authorization"] == f"Bearer {TEST_KEY}"
        assert "x-api-key" not in call.headers
        assert call.url == "https://api.moonshot.cn/anthropic/v1/messages"

    def test_anthropic_temperature_clamped_for_protocol_default(self):
        """自定义 + anthropic：1.5 超出 Anthropic 协议的 0~1，被夹到 1.0。"""
        assert do_call("custom", "anthropic").body["temperature"] == 1.0

    def test_anthropic_max_tokens_fallback_when_missing(self):
        """max_tokens 是 anthropic 的必填字段，配置缺失也不能让请求变成 400。"""
        call = do_call("kimi", "anthropic", max_tokens=None)
        assert call.body["max_tokens"] > 0


class TestDispatcherFallback:
    def test_unsupported_format_falls_back_to_default(self):
        """Qwen 只支持 chat；请求 anthropic 时回落 default_api_format 而不是 500。"""
        adapter, effective = resolve(get_profile("qwen"), "anthropic")
        assert effective == "chat"
        assert adapter.api_format == "chat"

    def test_unknown_format_falls_back(self):
        adapter, effective = resolve(get_profile("kimi"), "not-a-format")
        assert effective == "chat"
        assert adapter.api_format == "chat"
