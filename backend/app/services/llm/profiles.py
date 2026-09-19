"""供应商 profile 表（**唯一硬编码源**）。

结构约定（T48）：

- `base_url_by_format`：**交给 SDK 的纯 base**，不带路径后缀。SDK 自己会拼
  `/chat/completions`、`/responses` 或 `/v1/messages`。
- `path_suffix_by_format`：**"SDK 会拼什么"的事实登记，不参与请求构造**。
  仅用于两处：派生展示/诊断用的最终 URL、校验用户没把后缀写进 BaseURL。
  把它拼进 base_url 会双后缀 404（详见 url_builder 的模块 docstring）。
- `auth_by_format`：只决定**认证头**——`anthropic` = x-api-key（+ anthropic-version），
  `bearer` = Authorization: Bearer。同一家厂商的两个格式可以不同
  （DeepSeek：chat/responses 用 bearer，anthropic 用 x-api-key）。
- `header_overrides_by_format`：覆盖/删除协议默认头，值为 `None` 表示**显式去掉**。
  ⚠️ 实测限制（anthropic 1.6 / httpx2）：`anthropic-version` 由 SDK 自己**强制下发**，
  用 `default_headers` 覆盖不掉它。所以"某些端点忽略该头"这类事实不必写成本字段的
  覆盖项——写了也去不掉，反而让数据说谎。本字段保留为扩展点（离线单测覆盖 None 语义）。
- `param_policy`：按 api_format 的**厂商差异**（协议内置差异在 normalizer）。
- `default_api_format`：反推迁移时的歧义消解项，必须 ∈ supported_formats。

**协议族不是 profile 字段**：它由 api_format 唯一决定（chat/responses → openai 族，
anthropic → anthropic 族）。同一家厂商横跨两族，所以"protocol 挂在 profile 上"是错的。

新增一家 OpenAI 兼容厂商 = 在这里加一条 profile；新增一个协议族 = 加一个 adapter。
"""
from dataclasses import dataclass, field
from typing import Literal

from .param_policy import ParamPolicy
from .url_builder import derive_final_url, normalize_base_url

ApiFormat = Literal["chat", "responses", "anthropic"]
AuthKind = Literal["bearer", "anthropic"]

API_FORMATS: tuple[str, ...] = ("chat", "responses", "anthropic")

# 前端下拉的显示文案（下发给前端，避免前端持有硬编码中文）
API_FORMAT_LABELS: dict[str, str] = {
    "chat": "Chat Completions",
    "responses": "OpenAI Responses",
    "anthropic": "Anthropic Messages",
}

ANTHROPIC_VERSION = "2023-06-01"

# Kimi 的采样参数只接受固定值（思考模式 1.0 / 非思考模式 0.6），传别的值直接 400。
KIMI_DROP_PARAMS: tuple[str, ...] = (
    "temperature",
    "top_p",
    "presence_penalty",
    "frequency_penalty",
)

HINT_TEMPLATE = "当前预设会调用 `{url}`。若你修改了 BaseURL，以测试连接返回的最终 URL 为准。"
HINT_CUSTOM = "自定义预设没有默认 URL，请填写 BaseURL 并以测试连接返回的最终 URL 为准。"


@dataclass(frozen=True)
class ModelNames:
    """预设推荐模型（前端切换预设时自动填充主/备用模型输入框）。"""

    primary: str = ""
    fallback: str = ""
    flagship: str = ""


@dataclass(frozen=True)
class ProviderProfile:
    id: str
    label: str
    base_url_by_format: dict[str, str]
    path_suffix_by_format: dict[str, str]
    auth_by_format: dict[str, str]
    default_api_format: str
    supported_formats: tuple[str, ...]
    models: ModelNames = ModelNames()
    header_overrides_by_format: dict[str, dict[str, str | None]] = field(default_factory=dict)
    param_policy: dict[str, ParamPolicy] = field(default_factory=dict)
    # 仅用于老档案反推的等价 base（如官方文档认可但非我们下发的 /v1 写法）。
    # **不影响请求构造**，只让历史配置仍能匹配到预设。
    base_url_aliases: dict[str, tuple[str, ...]] = field(default_factory=dict)

    def supports(self, api_format: str) -> bool:
        return api_format in self.supported_formats

    def base_url(self, api_format: str) -> str:
        return self.base_url_by_format.get(api_format, "")

    def path_suffix(self, api_format: str) -> str:
        return self.path_suffix_by_format.get(api_format, "")

    def auth(self, api_format: str) -> str:
        return self.auth_by_format.get(api_format, "bearer")

    def header_overrides(self, api_format: str) -> dict[str, str | None]:
        return self.header_overrides_by_format.get(api_format, {})

    def policy(self, api_format: str) -> ParamPolicy:
        return self.param_policy.get(api_format, ParamPolicy())

    def final_url(self, api_format: str) -> str | None:
        """展示/诊断用的最终 URL；无 base 的预设（自定义）返回 None。"""
        return derive_final_url(self.base_url(api_format), self.path_suffix(api_format))

    def hint(self, api_format: str) -> str:
        url = self.final_url(api_format)
        return HINT_CUSTOM if url is None else HINT_TEMPLATE.format(url=url)


DEEPSEEK = ProviderProfile(
    id="deepseek",
    label="DeepSeek",
    # 官方 /guides/responses_api：base_url 用 https://api.deepseek.com（无 /v1），SDK 自拼路由
    base_url_by_format={
        "chat": "https://api.deepseek.com",
        "responses": "https://api.deepseek.com",
        "anthropic": "https://api.deepseek.com/anthropic",
    },
    path_suffix_by_format={
        "chat": "/chat/completions",
        "responses": "/responses",
        "anthropic": "/v1/messages",
    },
    auth_by_format={"chat": "bearer", "responses": "bearer", "anthropic": "anthropic"},
    default_api_format="chat",
    supported_formats=("chat", "responses", "anthropic"),
    # Responses API 目前只支持 deepseek-flash（官方文档），正好是本预设的主模型
    models=ModelNames(primary="deepseek-flash", fallback="deepseek-v4-pro"),
    # 官方文档：/v1 与不带 /v1 等价（仓库既有 .env 用的就是 /v1）——只影响反推
    base_url_aliases={
        "chat": ("https://api.deepseek.com/v1",),
        "responses": ("https://api.deepseek.com/v1",),
    },
    param_policy={
        # 官方 /guides/anthropic_api：temperature 支持 [0.0 ~ 2.0]——与 Anthropic 官方的 0~1 不同，
        # 所以必须由厂商层覆盖协议内置范围
        "anthropic": ParamPolicy(clamp={"temperature": (0.0, 2.0)}),
    },
)

KIMI = ProviderProfile(
    id="kimi",
    label="Kimi",
    base_url_by_format={
        "chat": "https://api.moonshot.cn/v1",
        "responses": "https://api.moonshot.cn/v1",
        "anthropic": "https://api.moonshot.cn/anthropic",
    },
    path_suffix_by_format={
        "chat": "/chat/completions",
        "responses": "/responses",
        "anthropic": "/v1/messages",
    },
    # 特例：Kimi 的 anthropic 端点也用 Bearer（不是 x-api-key）。
    # 靠 auth 字段表达，adapter 里不写任何厂商分支。
    auth_by_format={"chat": "bearer", "responses": "bearer", "anthropic": "bearer"},
    default_api_format="chat",
    supported_formats=("chat", "responses", "anthropic"),
    # 只推荐**有来源**的型号（见 test_llm_provider_presets.RECOMMENDED_MODEL_SOURCES）。
    # kimi-k3：规格里写过"旗舰可选"，但 2026-09-18 实测连不上（k2.7-code 正常），
    # 在查清原因前**不进推荐**——推荐一个连不上的型号比不推荐更糟。
    models=ModelNames(primary="kimi-k2.7-code", fallback="kimi-k2.6"),
    param_policy={
        api_format: ParamPolicy(drop=KIMI_DROP_PARAMS)
        for api_format in ("chat", "responses", "anthropic")
    },
)

QWEN = ProviderProfile(
    id="qwen",
    label="通义千问 Qwen",
    # 仅 OpenAI 兼容端点；Anthropic 兼容端点需要 WorkspaceId，本期不做
    base_url_by_format={"chat": "https://dashscope.aliyuncs.com/compatible-mode/v1"},
    path_suffix_by_format={"chat": "/chat/completions"},
    auth_by_format={"chat": "bearer"},
    default_api_format="chat",
    supported_formats=("chat",),
    models=ModelNames(primary="qwen3-coder-plus", fallback="qwen3-vl-plus"),
)

CUSTOM = ProviderProfile(
    id="custom",
    label="自定义",
    base_url_by_format={"chat": "", "responses": "", "anthropic": ""},
    path_suffix_by_format={
        "chat": "/chat/completions",
        "responses": "/responses",
        "anthropic": "/v1/messages",
    },
    # 表单没有"认证方式"字段：自定义的 anthropic 走 SDK 默认（x-api-key）。
    # Bearer-only 的自定义 anthropic 端点本期走不通——已登记为已知限制。
    auth_by_format={"chat": "bearer", "responses": "bearer", "anthropic": "anthropic"},
    default_api_format="chat",
    supported_formats=("chat", "responses", "anthropic"),
)

PROFILES: dict[str, ProviderProfile] = {
    profile.id: profile for profile in (DEEPSEEK, KIMI, QWEN, CUSTOM)
}


def get_profile(profile_id: str | None) -> ProviderProfile:
    """按 id 取 profile；未知 id（含空值）回落到自定义（最保守）。"""
    return PROFILES.get((profile_id or "").strip(), CUSTOM)


def match_profile(base_url: str) -> tuple[str, str] | None:
    """按归一化 base_url 反推 (profile_id, api_format)；匹配不上返回 None。

    老档案迁移用：缺 `llm_provider` 时靠它回填，否则现网 Kimi 档案拿不到
    参数剔除策略（temperature 400 修不掉）。

    命中多个 format 时取 `default_api_format`——DeepSeek 的 chat 与 responses
    共用同一个 base，这条今天就会触发，不是假想情况。
    """
    target = normalize_base_url(base_url).lower()
    if not target:
        return None
    for profile in PROFILES.values():
        hits: list[str] = []
        for api_format, url in profile.base_url_by_format.items():
            candidates = (url, *profile.base_url_aliases.get(api_format, ()))
            if any(
                normalize_base_url(item) and normalize_base_url(item).lower() == target
                for item in candidates
            ):
                hits.append(api_format)
        if not hits:
            continue
        preferred = profile.default_api_format
        return profile.id, preferred if preferred in hits else hits[0]
    return None


def provider_payload(profile: ProviderProfile) -> dict:
    """下发给前端的预设数据（前端只渲染，不做任何规则推导）。"""
    final_urls = {fmt: profile.final_url(fmt) for fmt in profile.supported_formats}
    return {
        # 以下三键为既有契约，保持原样（老前端 bundle 仍然能跑）
        "name": profile.label,
        "base_url": profile.base_url(profile.default_api_format),
        "model": profile.models.primary,
        "backup_model": profile.models.fallback,
        # 以下为 T48 新增
        "default_api_format": profile.default_api_format,
        "supported_formats": list(profile.supported_formats),
        "base_url_by_format": {
            fmt: profile.base_url(fmt) for fmt in profile.supported_formats
        },
        "final_url_by_format": final_urls,
        "hint_by_format": {fmt: profile.hint(fmt) for fmt in profile.supported_formats},
        "models": {
            "primary": profile.models.primary,
            "fallback": profile.models.fallback,
            "flagship": profile.models.flagship,
        },
        "param_policy": {
            fmt: {
                "drop": list(policy.drop),
                "clamp": {k: list(v) for k, v in policy.clamp.items()},
                "rename": dict(policy.rename),
            }
            for fmt, policy in profile.param_policy.items()
        },
    }


def profiles_payload() -> dict:
    return {profile_id: provider_payload(profile) for profile_id, profile in PROFILES.items()}
