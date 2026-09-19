"""T48 供应商预设：数据完整性与纯函数测试（零网络）。

注意与既有 `test_llm_profiles.py` 区分：那个测的是 **T34 接口档案**（用户保存的多套接口
配置），本文件测的是**供应商预设**（代码里的 profile 表）。

真实 SDK 的 URL / header / body 断言在 `test_llm_protocols.py`（httpx.MockTransport）。
"""
import pytest

from app.services.llm.normalizer import PROTOCOL_DEFAULT_HEADERS, merge_headers
from app.services.llm.param_policy import ParamPolicy, apply, apply_layers
from app.services.llm.profiles import (
    PROFILES,
    get_profile,
    match_profile,
    provider_payload,
)
from app.services.llm.url_builder import (
    RESERVED_PATH_MESSAGE,
    RESERVED_PATH_SUFFIXES,
    derive_final_url,
    find_reserved_suffix,
    normalize_base_url,
    normalize_path_suffix,
    validate_base_url,
)

# 由数据推导的 (预设 × 格式) 组合——不是手写清单
COMBINATIONS = sorted(
    (profile_id, api_format)
    for profile_id, profile in PROFILES.items()
    for api_format in profile.supported_formats
)

# 逐个写死的认证方式期望（特例必须显式，不靠默认分支）
EXPECTED_AUTH = {
    ("deepseek", "chat"): "bearer",
    ("deepseek", "responses"): "bearer",
    ("deepseek", "anthropic"): "anthropic",  # x-api-key
    ("kimi", "chat"): "bearer",
    ("kimi", "responses"): "bearer",
    ("kimi", "anthropic"): "bearer",  # 特例：Kimi 的 anthropic 端点也用 Bearer
    ("qwen", "chat"): "bearer",
    ("custom", "chat"): "bearer",
    ("custom", "responses"): "bearer",
    ("custom", "anthropic"): "anthropic",
}

EXPECTED_PRIMARY_MODEL = {
    "deepseek": "deepseek-flash",
    "kimi": "kimi-k2.7-code",
    "qwen": "qwen3-coder-plus",
    "custom": "",
}

# 允许出现在预设推荐里的型号 → 来源（**新增型号必须显式登记来源**，否则守卫测试会红）。
# 这条守卫的由来：曾把规格里写的 kimi-k3 直接放进推荐，实测却连不上（k2.7-code 正常）——
# 推荐一个连不上的型号，用户点一下就会撞 401/404。
RECOMMENDED_MODEL_SOURCES = {
    "deepseek-flash": "官方文档（Responses API 支持型号）+ 规格推荐",
    "deepseek-v4-pro": "规格推荐（备用模型）",
    "kimi-k2.7-code": "实测可连（2026-09-18）",
    "kimi-k2.6": "规格推荐（备用模型）",
    "qwen3-coder-plus": "规格推荐（旧 id qwen-coder-plus 已下线）",
    "qwen3-vl-plus": "规格推荐（带视觉，备用）",
}


class TestProfileIntegrity:
    def test_expected_auth_table_matches_data(self):
        """反向护栏：期望表键集合必须等于数据展开集合。

        新增预设/格式而漏更新期望表 → 这里直接红，不会静默漏测。
        """
        assert set(EXPECTED_AUTH) == set(COMBINATIONS)

    @pytest.mark.parametrize("profile_id,api_format", COMBINATIONS)
    def test_auth_matches_expected_matrix(self, profile_id, api_format):
        profile = get_profile(profile_id)
        assert profile.auth(api_format) == EXPECTED_AUTH[(profile_id, api_format)]

    @pytest.mark.parametrize("profile_id,api_format", COMBINATIONS)
    def test_supported_format_has_base_and_suffix(self, profile_id, api_format):
        profile = get_profile(profile_id)
        assert profile.path_suffix(api_format), f"{profile_id}/{api_format} 缺 path_suffix"
        base = profile.base_url(api_format)
        if profile_id == "custom":
            assert base == "", "自定义预设的 base 必须为空（由用户填）"
        else:
            assert base.startswith("http"), f"{profile_id}/{api_format} 缺 base_url"

    @pytest.mark.parametrize("profile_id", sorted(PROFILES))
    def test_param_policy_keys_subset_of_supported(self, profile_id):
        profile = get_profile(profile_id)
        assert set(profile.param_policy) <= set(profile.supported_formats)

    @pytest.mark.parametrize("profile_id", sorted(PROFILES))
    def test_default_format_is_supported(self, profile_id):
        """反推歧义时要回落到 default_api_format，它必须真的可用。"""
        profile = get_profile(profile_id)
        assert profile.default_api_format in profile.supported_formats

    @pytest.mark.parametrize("profile_id", sorted(PROFILES))
    def test_primary_model(self, profile_id):
        assert get_profile(profile_id).models.primary == EXPECTED_PRIMARY_MODEL[profile_id]

    def test_recommended_models_have_declared_sources(self):
        """守卫：预设推荐的每个型号都必须在来源表里显式登记（防止再推荐未验证型号）。"""
        unlisted = [
            f"{profile_id}.{name}"
            for profile_id, profile in PROFILES.items()
            for name in (profile.models.primary, profile.models.fallback, profile.models.flagship)
            if name and name not in RECOMMENDED_MODEL_SOURCES
        ]
        assert not unlisted, f"预设推荐了没有来源登记的型号：{unlisted}"

    def test_sources_table_has_no_dead_entries(self):
        """反向：来源表里也不该有已不再推荐的型号（两边必须一致）。"""
        used = {
            name
            for profile in PROFILES.values()
            for name in (profile.models.primary, profile.models.fallback, profile.models.flagship)
            if name
        }
        assert set(RECOMMENDED_MODEL_SOURCES) == used

    def test_kimi_k3_not_recommended_until_verified(self):
        """kimi-k3 实测连不上（2026-09-18），查清原因前不进推荐。

        推荐一个连不上的型号，用户点一下就会撞 401/404 —— 比不推荐更糟。
        """
        assert "kimi-k3" not in RECOMMENDED_MODEL_SOURCES
        assert get_profile("kimi").models.flagship == ""

    @pytest.mark.parametrize("profile_id,api_format", COMBINATIONS)
    def test_path_suffix_contains_a_reserved_suffix(self, profile_id, api_format):
        """reserved 名单与 path_suffix 是两份**独立**常量，靠这条包含性断言绑定。

        不能用等式：reserved 里是 `/messages`，而 path_suffix 是 `/v1/messages`——
        等式断言必然失败，而子串断言才是真正要保的不变量（用户手打的 `.../messages`
        也得被拦下）。
        """
        suffix = get_profile(profile_id).path_suffix(api_format)
        assert any(reserved in suffix for reserved in RESERVED_PATH_SUFFIXES), (
            f"{profile_id}/{api_format} 的 {suffix!r} 不在任何 reserved 后缀的覆盖内"
        )

    def test_kimi_drops_sampling_params_in_every_format(self):
        """Kimi 的 temperature 只接受固定值，传别的值 400 —— 三个格式都必须 drop。"""
        profile = get_profile("kimi")
        for api_format in profile.supported_formats:
            assert "temperature" in profile.policy(api_format).drop

    def test_deepseek_anthropic_clamps_to_documented_range(self):
        """官方 /guides/anthropic_api：DeepSeek 的 anthropic 端点是 0~2，不是 0~1。"""
        assert get_profile("deepseek").policy("anthropic").clamp["temperature"] == (0.0, 2.0)


class TestUrlBuilder:
    def test_normalize_base_url(self):
        assert normalize_base_url("  https://a.com/v1/  ") == "https://a.com/v1"
        assert normalize_base_url("") == ""
        assert normalize_base_url(None) == ""

    def test_normalize_path_suffix(self):
        assert normalize_path_suffix("chat/completions") == "/chat/completions"
        assert normalize_path_suffix("/responses") == "/responses"
        assert normalize_path_suffix("") == ""

    @pytest.mark.parametrize(
        "base_url",
        [
            "https://api.deepseek.com/chat/completions",
            "https://api.deepseek.com/responses",
            "https://api.moonshot.cn/anthropic/v1/messages",
            "https://x.com/v1/messages",
        ],
    )
    def test_rejects_path_suffix(self, base_url):
        assert find_reserved_suffix(base_url) is not None
        reason = validate_base_url(base_url)
        assert reason is not None and reason.startswith(RESERVED_PATH_MESSAGE)

    @pytest.mark.parametrize(
        "base_url",
        [
            "https://api.deepseek.com",
            "https://api.deepseek.com/v1",
            "https://api.deepseek.com/anthropic",
            "https://dashscope.aliyuncs.com/compatible-mode/v1",
            "",
        ],
    )
    def test_allows_base_without_suffix(self, base_url):
        assert find_reserved_suffix(base_url) is None
        assert validate_base_url(base_url) is None

    def test_derive_final_url(self):
        assert (
            derive_final_url("https://a.com/v1/", "/chat/completions")
            == "https://a.com/v1/chat/completions"
        )

    def test_derive_final_url_none_when_base_empty(self):
        """空 base 必须返回 None（不是空串）——空串会被界面当成"后端算出来就是空"。"""
        assert derive_final_url("", "/chat/completions") is None
        assert get_profile("custom").final_url("chat") is None


class TestParamPolicy:
    def test_apply_drop_clamp_rename(self):
        policy = ParamPolicy(
            drop=("top_p",), clamp={"temperature": (0.0, 1.0)}, rename={"max_tokens": "mx"}
        )
        out = apply({"temperature": 1.5, "top_p": 0.9, "max_tokens": 10}, policy)
        assert out == {"temperature": 1.0, "mx": 10}

    def test_clamp_keeps_int_type(self):
        out = apply({"max_tokens": 99999}, ParamPolicy(clamp={"max_tokens": (0, 100)}))
        assert out["max_tokens"] == 100
        assert isinstance(out["max_tokens"], int)

    def test_clamp_skips_non_numbers(self):
        out = apply({"temperature": "hot"}, ParamPolicy(clamp={"temperature": (0.0, 1.0)}))
        assert out["temperature"] == "hot"

    def test_layers_order_drop_before_clamp(self):
        """被 drop 的参数不该再被 clamp——"Kimi + anthropic 请求体无 temperature" 靠这条成立。"""
        vendor = ParamPolicy(drop=("temperature",))
        protocol = ParamPolicy(clamp={"temperature": (0.0, 1.0)})
        assert apply_layers({"temperature": 1.5}, vendor, protocol) == {}

    def test_layers_vendor_override_wins(self):
        vendor = ParamPolicy(clamp={"temperature": (0.0, 2.0)})
        protocol = ParamPolicy(clamp={"temperature": (0.0, 1.0)})
        assert apply_layers({"temperature": 1.5}, vendor, protocol)["temperature"] == 1.5


class TestMergeHeaders:
    def test_protocol_default_headers(self):
        assert merge_headers("anthropic", {}) == PROTOCOL_DEFAULT_HEADERS["anthropic"]
        assert merge_headers("chat", {}) == {}

    def test_none_means_remove_and_result_has_no_none(self):
        """SDK 不认 None 值，合并必须在传输层做完——交给 SDK 的字典里不能有 None。"""
        merged = merge_headers("anthropic", {"anthropic-version": None})
        assert merged == {}
        assert all(value is not None for value in merged.values())

    def test_override_value_wins(self):
        merged = merge_headers("anthropic", {"anthropic-version": "2099-01-01"})
        assert merged["anthropic-version"] == "2099-01-01"

    def test_extra_header_passthrough(self):
        assert merge_headers("chat", {"X-Trace": "abc"}) == {"X-Trace": "abc"}


class TestProfileInference:
    """老档案迁移：缺 llm_provider 时按归一化 base_url 反推。"""

    def test_match_kimi(self):
        assert match_profile("https://api.moonshot.cn/v1") == ("kimi", "chat")

    def test_match_kimi_anthropic(self):
        assert match_profile(" https://api.moonshot.cn/anthropic/ ") == ("kimi", "anthropic")

    def test_match_deepseek_alias_and_ambiguous_format_falls_back_to_default(self):
        """/v1 是官方认可的等价写法（仅用于反推）；且 chat 与 responses 共用 base，
        命中多个时必须回落到 default_api_format。"""
        assert match_profile("https://api.deepseek.com/v1") == ("deepseek", "chat")
        assert match_profile("https://api.deepseek.com") == ("deepseek", "chat")

    def test_match_unknown_is_none(self):
        assert match_profile("https://example.com/v1") is None
        assert match_profile("") is None


class TestProviderPayload:
    def test_legacy_keys_kept(self):
        """既有契约三键（name/base_url/model）必须保持，老前端 bundle 才能继续跑。"""
        payload = provider_payload(get_profile("kimi"))
        assert payload["name"] == "Kimi"
        assert payload["base_url"] == "https://api.moonshot.cn/v1"
        assert payload["model"] == "kimi-k2.7-code"

    def test_new_fields_present(self):
        payload = provider_payload(get_profile("deepseek"))
        assert payload["default_api_format"] == "chat"
        assert payload["supported_formats"] == ["chat", "responses", "anthropic"]
        assert (
            payload["final_url_by_format"]["anthropic"]
            == "https://api.deepseek.com/anthropic/v1/messages"
        )
        assert payload["param_policy"]["anthropic"]["clamp"]["temperature"] == [0.0, 2.0]
        assert payload["hint_by_format"]["chat"].startswith("当前预设会调用")

    def test_custom_hint_has_no_url(self):
        payload = provider_payload(get_profile("custom"))
        assert payload["final_url_by_format"]["chat"] is None
        assert "没有默认 URL" in payload["hint_by_format"]["chat"]

    def test_kimi_drop_policy_visible_to_frontend(self):
        payload = provider_payload(get_profile("kimi"))
        assert payload["param_policy"]["chat"]["drop"] == [
            "temperature",
            "top_p",
            "presence_penalty",
            "frequency_penalty",
        ]
