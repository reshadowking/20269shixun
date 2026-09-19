"""按 api_format 分发到对应协议族 adapter。

**格式 → 协议族是一对一函数**，所以这里是查表，不是 if/elif 堆厂商分支。
新增一族只需在 ADAPTERS 里加一个 adapter。
"""
import logging

from .profiles import ProviderProfile
from .protocols.anthropic_msg import AnthropicMessagesAdapter
from .protocols.base import ProtocolAdapter
from .protocols.openai_compat import OpenAIChatAdapter, OpenAIResponsesAdapter

logger = logging.getLogger(__name__)

ADAPTERS: dict[str, ProtocolAdapter] = {
    adapter.api_format: adapter
    for adapter in (
        OpenAIChatAdapter(),
        OpenAIResponsesAdapter(),
        AnthropicMessagesAdapter(),
    )
}

FALLBACK_FORMAT = "chat"


def adapter_for(api_format: str) -> ProtocolAdapter | None:
    return ADAPTERS.get(api_format)


def resolve(profile: ProviderProfile, api_format: str) -> tuple[ProtocolAdapter, str]:
    """返回 (adapter, 实际生效格式)。

    格式非法（手改配置文件写坏了）或该预设不支持时，回落到预设的 default_api_format
    并记 warning：宁可降级也不要让整条生成链路 500。
    """
    if api_format in ADAPTERS and profile.supports(api_format):
        return ADAPTERS[api_format], api_format
    fallback = profile.default_api_format if profile.default_api_format in ADAPTERS else FALLBACK_FORMAT
    logger.warning(
        "API 格式 %r 不可用（预设 %s 支持 %s），回落到 %r",
        api_format,
        profile.id,
        list(profile.supported_formats),
        fallback,
    )
    return ADAPTERS[fallback], fallback
