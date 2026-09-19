"""协议族抽象。

**协议族由 api_format 唯一决定**（chat/responses → openai 族；anthropic → anthropic 族），
不是 profile 的字段——同一家厂商横跨两族（DeepSeek/Kimi 的 chat+responses 用 openai SDK、
anthropic 用 anthropic SDK）。新增一族 = 加一个 adapter；新增一家厂商 = 加一行 profile。

adapter 只做三件事：声明 `api_format`、组织请求、解析响应。
**客户端构造不属于 adapter**——生成链路的客户端必须从包命名空间解析、诊断端点保持
函数体内 import（两条 monkeypatch 契约），所以调用的 client 由外部建好传进来。
"""
from typing import Any, Protocol

from ..normalizer import LLMReply, RequestPlan
from ..profiles import ProviderProfile


def resolve_method(client: Any, method: str) -> Any:
    """按点号路径取 SDK 方法：`chat.completions.create` → `client.chat.completions.create`。"""
    target = client
    for part in method.split("."):
        target = getattr(target, part)
    return target


class ProtocolAdapter(Protocol):
    api_format: str
    method: str

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
    ) -> RequestPlan: ...

    def parse(self, response: Any) -> LLMReply: ...
