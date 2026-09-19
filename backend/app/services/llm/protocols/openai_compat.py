"""协议族 A：OpenAI 兼容（chat 与 responses 共用同一个 SDK 客户端）。

两个格式只差请求体形状与 max token 字段名，差别都在 normalizer 里；
本模块只声明 SDK 方法名，并接上对应的响应解析。
"""
from typing import Any

from ..normalizer import (
    LLMReply,
    RequestPlan,
    chat_kwargs,
    layered_params,
    parse_chat,
    parse_responses,
    responses_kwargs,
)
from ..profiles import ProviderProfile


class OpenAIChatAdapter:
    """Chat Completions：messages 数组。"""

    api_format = "chat"
    method = "chat.completions.create"

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
            kwargs=chat_kwargs(model, system, user, history, params),
            final_url=profile.final_url(self.api_format),
        )

    def parse(self, response: Any) -> LLMReply:
        return parse_chat(response)


class OpenAIResponsesAdapter:
    """Responses：`instructions` + `input`（不是 messages），无状态。"""

    api_format = "responses"
    method = "responses.create"

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
            kwargs=responses_kwargs(model, system, user, history, params),
            final_url=profile.final_url(self.api_format),
        )

    def parse(self, response: Any) -> LLMReply:
        return parse_responses(response)
