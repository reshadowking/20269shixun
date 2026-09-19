"""协议族 B：Anthropic Messages（独立 SDK）。

认证走 SDK 自己的参数：`api_key` → `x-api-key`，`auth_token` → `Authorization: Bearer`。
**认证方式与 anthropic-version 都由 profile 数据决定**，这里不写任何厂商分支——
Kimi 的 anthropic 端点用 Bearer，在数据上就是一个 `auth="bearer"`。

本文件是 anthropic SDK 客户端构造的唯一处（全仓该调用计数恒为 1）。
"""
from typing import Any

from ..normalizer import (
    LLMReply,
    RequestPlan,
    anthropic_kwargs,
    layered_params,
    parse_anthropic,
)
from ..profiles import ProviderProfile


def build_anthropic_client(
    *,
    api_key: str,
    base_url: str,
    timeout: float | None = None,
    auth: str = "anthropic",
    headers: dict[str, str] | None = None,
    http_client: Any | None = None,
) -> Any:
    """构造 anthropic SDK 客户端。

    - `auth="anthropic"`：x-api-key（Anthropic 官方 / DeepSeek 的 anthropic 端点）
    - `auth="bearer"`：Authorization: Bearer（Kimi 的 anthropic 端点）——
      此时**只给 auth_token**，避免 SDK 同时下发 x-api-key，否则端点可能拒绝。

    `http_client` 是测试接缝（注入 httpx.MockTransport 做零网络表驱动测试）。
    """
    from anthropic import Anthropic  # 函数体内 import：便于测试替换（与诊断端点风格一致）

    from ..sdk_options import with_sdk_defaults

    kwargs: dict[str, Any] = {"base_url": base_url}
    kwargs["auth_token" if auth == "bearer" else "api_key"] = api_key
    if timeout is not None:
        kwargs["timeout"] = timeout
    if headers:
        kwargs["default_headers"] = headers
    if http_client is not None:
        kwargs["http_client"] = http_client
    # T50：关掉 SDK 内部静默重试（默认 max_retries=2 会把一次逻辑调用放大成 3 倍超时）
    return Anthropic(**with_sdk_defaults(kwargs))


class AnthropicMessagesAdapter:
    """Messages：system 独立字段、messages 只允许 user/assistant、max_tokens 必填。"""

    api_format = "anthropic"
    method = "messages.create"

    def build(
        self,
        *,
        profile: ProviderProfile,
        model: str,
        system: str,
        user: str,
        history: list[dict] | None,
        temperature: float | None,
        max_tokens: int | None,
    ) -> RequestPlan:
        params = layered_params(self.api_format, temperature, max_tokens, profile)
        return RequestPlan(
            api_format=self.api_format,
            method=self.method,
            kwargs=anthropic_kwargs(model, system, user, history, params),
            final_url=profile.final_url(self.api_format),
        )

    def parse(self, response: Any) -> LLMReply:
        return parse_anthropic(response)
