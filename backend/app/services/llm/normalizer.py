"""请求/响应归一化：统一入参 → 各协议族的 kwargs / headers。

**适配层的真正价值在这里**，不在 URL 拼接。三家的参数集与形状差异：

| 格式 | temperature | max tokens 字段 | system 位置 | 响应文本 |
| --- | --- | --- | --- | --- |
| chat | 0~2 | `max_tokens` | messages[0] role=system | `choices[0].message.content` |
| responses | 0~2 | `max_output_tokens` | `instructions` | `output_text` / `output[].content[].text` |
| anthropic | 0~1（官方） | `max_tokens` **必填** | 独立 `system` 字段 | `content[].text` |

厂商差异（DeepSeek 的 anthropic 端点是 0~2、Kimi 要剔掉采样参数）走 profile 的
`param_policy`，本模块只提供**协议内置**的那一层与通用合并逻辑。
"""
from dataclasses import dataclass, field
from typing import Any

from .param_policy import ParamPolicy, apply_layers
from .profiles import ANTHROPIC_VERSION, ProviderProfile

# 协议内置参数策略：clamp 范围与字段改名
PROTOCOL_PARAM_POLICY: dict[str, ParamPolicy] = {
    "chat": ParamPolicy(clamp={"temperature": (0.0, 2.0)}),
    "responses": ParamPolicy(
        clamp={"temperature": (0.0, 2.0)},
        rename={"max_tokens": "max_output_tokens"},
    ),
    "anthropic": ParamPolicy(clamp={"temperature": (0.0, 1.0)}),
}

# 协议默认头（认证头不在此——认证由 SDK 的 api_key / auth_token 参数负责）
PROTOCOL_DEFAULT_HEADERS: dict[str, dict[str, str]] = {
    "chat": {},
    "responses": {},
    "anthropic": {"anthropic-version": ANTHROPIC_VERSION},
}

# anthropic 的 max_tokens 必填；配置异常时也不让请求变成 400
ANTHROPIC_FALLBACK_MAX_TOKENS = 4096

# anthropic SDK 1.6 的 messages.create **没有** temperature/top_p 参数（整个 SDK 里
# 搜不到 "temperature" 这个字符串，采样参数已移出类型化 API）。但这些参数仍属于
# Messages 的请求体——用 extra_body 原样透传，否则"配了 0.1 温度做 JSON 解析"
# 会静默失效（直接影响输出稳定性）。
ANTHROPIC_EXTRA_BODY_PARAMS: tuple[str, ...] = (
    "temperature",
    "top_p",
    "presence_penalty",
    "frequency_penalty",
)


@dataclass(frozen=True)
class LLMReply:
    """归一化后的模型回复（记账与上层逻辑只认这个形状）。

    `finish_reason` 三家叫法不同（finish_reason / status / stop_reason），
    归一到这里只为保留既有日志的诊断价值（"输出截断"靠它看出来）。
    """

    text: str
    model: str
    tokens_in: int = 0
    tokens_out: int = 0
    finish_reason: str = ""


@dataclass(frozen=True)
class RequestPlan:
    """一次调用的最终形态：SDK 方法名 + kwargs + 展示用最终 URL。"""

    api_format: str
    method: str
    kwargs: dict[str, Any] = field(default_factory=dict)
    final_url: str | None = None


def merge_headers(api_format: str, overrides: dict[str, str | None] | None) -> dict[str, str]:
    """协议默认头 → 应用 overrides（`None` = 删除该键）→ 过滤掉所有 `None`。

    **必须在传输层（我们这层）合并**：SDK 不认 `None` 值，不同版本行为还不一致，
    不能赌——所以交给 SDK 的 headers 里永远不含 None。
    """
    merged: dict[str, Any] = dict(PROTOCOL_DEFAULT_HEADERS.get(api_format, {}))
    for key, value in (overrides or {}).items():
        if value is None:
            merged.pop(key, None)
        else:
            merged[key] = value
    return {str(key): str(value) for key, value in merged.items() if value is not None}


def layered_params(
    api_format: str, temperature: float | None, max_tokens: int | None, profile: ProviderProfile
) -> dict:
    """把温度与输出上限过三层策略，得到该协议的参数 dict。

    顺序：①厂商 drop → ②协议内置 → ③厂商 override（见 param_policy.apply_layers）。
    """
    params: dict[str, Any] = {}
    if temperature is not None:
        params["temperature"] = float(temperature)
    if max_tokens is not None:
        params["max_tokens"] = int(max_tokens)
    protocol = PROTOCOL_PARAM_POLICY.get(api_format, ParamPolicy())
    return apply_layers(params, profile.policy(api_format), protocol)


def _clean_history(history: list[dict] | None) -> list[dict]:
    """只保留 user/assistant 且内容非空的轮次（anthropic 只允许这两种角色）。"""
    clean: list[dict] = []
    for item in history or []:
        if not isinstance(item, dict):
            continue
        role = item.get("role")
        content = item.get("content")
        if role in ("user", "assistant") and isinstance(content, str) and content.strip():
            clean.append({"role": role, "content": content})
    return clean


def chat_kwargs(
    model: str,
    system: str,
    user: str,
    history: list[dict] | None,
    params: dict,
) -> dict:
    """OpenAI Chat Completions：messages 数组，system 作为首条消息。"""
    return {
        "model": model,
        "messages": [
            {"role": "system", "content": system},
            *_clean_history(history),
            {"role": "user", "content": user},
        ],
        **params,
    }


def responses_kwargs(
    model: str,
    system: str,
    user: str,
    history: list[dict] | None,
    params: dict,
) -> dict:
    """OpenAI Responses：**不是 messages**——`instructions` 放系统指令，
    `input` 放对话数组。

    无状态：多轮必须把完整历史放进 `input`（官方文档明确 `previous_response_id`
    与 `conversation` 均不支持）。
    """
    return {
        "model": model,
        "instructions": system,
        "input": [*_clean_history(history), {"role": "user", "content": user}],
        **params,
    }


def anthropic_kwargs(
    model: str,
    system: str,
    user: str,
    history: list[dict] | None,
    params: dict,
) -> dict:
    """Anthropic Messages：`system` 是独立字段（不是 messages 里的 role），
    messages 只允许 user/assistant，且 `max_tokens` **必填**。

    SDK 不认的采样参数走 `extra_body`（见 ANTHROPIC_EXTRA_BODY_PARAMS 的说明）。
    """
    kwargs = {
        "model": model,
        "system": system,
        "messages": [*_clean_history(history), {"role": "user", "content": user}],
        **params,
    }
    if not kwargs.get("max_tokens"):
        kwargs["max_tokens"] = ANTHROPIC_FALLBACK_MAX_TOKENS
    extra_body = {key: kwargs.pop(key) for key in ANTHROPIC_EXTRA_BODY_PARAMS if key in kwargs}
    if extra_body:
        kwargs["extra_body"] = extra_body
    return kwargs


def _field(obj: Any, name: str, default: Any = None) -> Any:
    """兼容"对象属性"与"字典键"两种取值（不同 SDK / 测试替身形状不一样）。"""
    if isinstance(obj, dict):
        return obj.get(name, default)
    return getattr(obj, name, default)


def mock_reply(api_format: str, text: str, model: str) -> dict:
    """按 api_format 生成**模拟响应结构**（Mock 模式下诊断端点返回它，不调远程）。

    三种结构的形状与真实响应一致，前端/排查时看到的东西不会骗人。
    """
    if api_format == "responses":
        return {
            "model": model,
            "output": [
                {
                    "type": "message",
                    "role": "assistant",
                    "content": [{"type": "output_text", "text": text}],
                }
            ],
        }
    if api_format == "anthropic":
        return {
            "model": model,
            "content": [{"type": "text", "text": text}],
            "stop_reason": "end_turn",
        }
    return {"model": model, "choices": [{"message": {"role": "assistant", "content": text}}]}


def parse_chat(response: Any) -> LLMReply:
    """`{ choices: [{ message: { content } }] }`"""
    choices = _field(response, "choices") or []
    message = _field(choices[0], "message") if choices else None
    usage = _field(response, "usage")
    return LLMReply(
        text=(_field(message, "content") or "") if message is not None else "",
        model=str(_field(response, "model", "") or ""),
        tokens_in=int(_field(usage, "prompt_tokens", 0) or 0),
        tokens_out=int(_field(usage, "completion_tokens", 0) or 0),
        finish_reason=str(_field(choices[0], "finish_reason", "") or "") if choices else "",
    )


def parse_responses(response: Any) -> LLMReply:
    """`{ output: [{ type: "message", content: [{ type: "output_text", text }] }] }`

    SDK 提供了 `output_text` 便捷属性时优先用它；否则自己扫 output 块。
    """
    text = _field(response, "output_text")
    if text is None:
        parts: list[str] = []
        for item in _field(response, "output") or []:
            if _field(item, "type") != "message":
                continue
            for block in _field(item, "content") or []:
                if _field(block, "type") in ("output_text", "text"):
                    parts.append(str(_field(block, "text", "") or ""))
        text = "".join(parts)
    usage = _field(response, "usage")
    return LLMReply(
        text=str(text or ""),
        model=str(_field(response, "model", "") or ""),
        tokens_in=int(_field(usage, "input_tokens", 0) or 0),
        tokens_out=int(_field(usage, "output_tokens", 0) or 0),
        finish_reason=str(_field(response, "status", "") or ""),
    )


def parse_anthropic(response: Any) -> LLMReply:
    """`{ content: [{ type: "text", text }] }`"""
    parts: list[str] = []
    for block in _field(response, "content") or []:
        if _field(block, "type") == "text":
            parts.append(str(_field(block, "text", "") or ""))
    usage = _field(response, "usage")
    return LLMReply(
        text="".join(parts),
        model=str(_field(response, "model", "") or ""),
        tokens_in=int(_field(usage, "input_tokens", 0) or 0),
        tokens_out=int(_field(usage, "output_tokens", 0) or 0),
        finish_reason=str(_field(response, "stop_reason", "") or ""),
    )
