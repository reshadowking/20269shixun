"""SDK 客户端的公共参数（T50）。

为什么需要：`openai` 与 `anthropic` 两个 SDK 的 `max_retries` **默认都是 2**，而
`LLMClient` 自己实现了带预算感知的重试链（超时 → 重试 1 次 → 切备用模型，每步都写日志）。
SDK 的内部重试**不写日志、不受 `GenerationDeadline` 约束**——实测把"45s 全链路预算"
放大成 137s（3 × 45s），用户等两分多钟得到一个"画布保持原样"。

**结构约定**：所有 SDK 客户端的构造（`build_client` 的 openai 族、
`protocols/anthropic_msg.build_anthropic_client`）都必须经 `with_sdk_defaults` 补参数——
新增协议族时漏调它，超时就会被静默放大 3 倍。
详见 `docs/T50-待修-SDK静默重试拖垮时间预算.md`。
"""
from typing import Any

SDK_MAX_RETRIES = 0


def with_sdk_defaults(kwargs: dict[str, Any]) -> dict[str, Any]:
    """补齐 SDK 客户端的公共默认参数；**已显式传的不覆盖**。"""
    kwargs.setdefault("max_retries", SDK_MAX_RETRIES)
    return kwargs
