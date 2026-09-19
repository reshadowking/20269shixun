"""LLM 配置接口（API 配置页：前端直接配置 Key/供应商，立即生效，无需改 .env）。"""
import logging
import time
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator

from ..llm_runtime import (
    LEGACY_PROVIDER_ALIASES,
    activate_profile,
    delete_profile,
    is_masked_key,
    list_profiles,
    mask_api_key,
    public_config,
    save_profile,
    save_runtime_config,
)
from ..security import get_current_user
from ..services.llm.profiles import PROFILES, get_profile

logger = logging.getLogger(__name__)
router = APIRouter(tags=["llm-config"])

# 协议族由 api_format 唯一决定，取值是稳定的协议级枚举（新增一族才会变）
ApiFormat = Literal["chat", "responses", "anthropic"]


class LLMConfigUpdate(BaseModel):
    llm_mode: str | None = Field(default=None, max_length=20)
    llm_base_url: str | None = Field(default=None, max_length=200)
    llm_api_key: str | None = Field(default=None, max_length=200)
    llm_model: str | None = Field(default=None, max_length=100)
    llm_backup_model: str | None = Field(default=None, max_length=100)
    llm_timeout_seconds: float | None = Field(default=None, ge=10, le=300)
    llm_max_tokens: int | None = Field(default=None, ge=1024, le=65536)
    # T48：供应商预设与 API 格式（纯新增，旧调用方不传也能工作）
    llm_provider: str | None = Field(default=None, max_length=32)
    llm_api_format: ApiFormat | None = None

    @field_validator("llm_provider")
    @classmethod
    def _validate_provider(cls, value: str | None) -> str | None:
        """按 profiles 表校验（**数据驱动**，新增预设不必改这里）；旧 id 归一为现值。"""
        if value is None or not value.strip():
            return None
        provider = LEGACY_PROVIDER_ALIASES.get(value.strip(), value.strip())
        if provider not in PROFILES:
            raise ValueError(f"未知的供应商预设：{value}")
        return provider


@router.get("/api/llm-config")
def get_config(_user: str = Depends(get_current_user)):
    """当前生效配置（API Key 脱敏）+ 供应商预设。"""
    return public_config()


@router.post("/api/llm-config")
def update_config(req: LLMConfigUpdate, _user: str = Depends(get_current_user)):
    """保存运行时配置（空值不覆盖；仅白名单字段；立即生效）。"""
    values = req.model_dump(exclude_none=True)
    if not values:
        raise HTTPException(status_code=422, detail="没有可保存的配置项")
    return public_config_after(values)


def public_config_after(values: dict) -> dict:
    save_runtime_config(values)
    return public_config()


class ProfileUpsert(BaseModel):
    """T34：保存/新建档案（id 缺省表示新建；name 可命名；Key 传空或脱敏值则不覆盖）。"""

    id: str | None = Field(default=None, max_length=64)
    name: str | None = Field(default=None, max_length=60)
    llm_base_url: str | None = Field(default=None, max_length=200)
    llm_api_key: str | None = Field(default=None, max_length=200)
    llm_model: str | None = Field(default=None, max_length=100)
    llm_backup_model: str | None = Field(default=None, max_length=100)
    llm_timeout_seconds: float | None = Field(default=None, ge=10, le=300)
    # T48：档案各自记住用的是哪家预设、哪种 API 格式
    llm_provider: str | None = Field(default=None, max_length=32)
    llm_api_format: ApiFormat | None = None

    @field_validator("llm_provider")
    @classmethod
    def _validate_provider(cls, value: str | None) -> str | None:
        if value is None or not value.strip():
            return None
        provider = LEGACY_PROVIDER_ALIASES.get(value.strip(), value.strip())
        if provider not in PROFILES:
            raise ValueError(f"未知的供应商预设：{value}")
        return provider


def _masked_profiles() -> dict:
    data = list_profiles()
    return {
        "active": data["active"],
        "profiles": [
            {**p, "llm_api_key": mask_api_key(str(p.get("llm_api_key") or ""))} for p in data["profiles"]
        ],
    }


@router.get("/api/llm-config/profiles")
def get_profiles(_user: str = Depends(get_current_user)):
    """T34：全部接口档案（Key 脱敏）+ 当前生效档案 id。"""
    return _masked_profiles()


@router.post("/api/llm-config/profiles")
def upsert_profile(req: ProfileUpsert, _user: str = Depends(get_current_user)):
    """保存或新建档案，并设为当前生效（保存即切换）。"""
    values = req.model_dump(exclude_none=True, exclude={"id", "name"})
    if not values and not req.id:
        raise HTTPException(status_code=422, detail="没有可保存的配置项")
    save_profile(values, profile_id=req.id, name=req.name)
    return _masked_profiles()


@router.post("/api/llm-config/profiles/{profile_id}/activate")
def switch_profile(profile_id: str, _user: str = Depends(get_current_user)):
    """切换当前生效档案（不通配 —— 每个档案的地址/模型/Key 互不覆盖）。"""
    if activate_profile(profile_id) is None:
        raise HTTPException(status_code=404, detail=f"档案不存在：{profile_id}")
    return _masked_profiles()


@router.delete("/api/llm-config/profiles/{profile_id}")
def remove_profile(profile_id: str, _user: str = Depends(get_current_user)):
    """删除档案（至少保留一个；删当前档案自动切到第一个）。"""
    if not delete_profile(profile_id):
        raise HTTPException(status_code=404, detail="档案不存在，或不允许删除最后一个档案")
    return _masked_profiles()


# 连接测试的最小请求（非流式；max_tokens 取小值，成本可忽略）
TEST_SYSTEM = "你是连接测试助手，回答从简。"
TEST_PROMPT = "你好，请回复：连接成功"
TEST_MAX_TOKENS = 16
MOCK_REPLY_TEXT = "连接成功（Mock 模式，未调用远程）"
TEST_CONFIG_KEYS = ("llm_base_url", "llm_api_key", "llm_model", "llm_provider", "llm_api_format")


def _merged_test_config(req: LLMConfigUpdate) -> dict:
    """测试用配置 = 当前生效配置 ∪ 本次请求值（内存合并，**不落盘**）。

    请求里的脱敏 key（含 ****）一律忽略，防止把回显值当真实 Key 测试/写坏。
    """
    from ..llm_runtime import get_runtime_config

    merged = dict(get_runtime_config())
    for key, value in req.model_dump(exclude_none=True).items():
        if key not in TEST_CONFIG_KEYS:
            continue
        if value is None or (isinstance(value, str) and not value.strip()):
            continue
        if key == "llm_api_key" and is_masked_key(str(value)):
            continue  # 脱敏值不参与测试，使用已保存的真实 Key
        merged[key] = value
    return merged


def _safe_attr(obj: Any, name: str) -> Any:
    """安全取属性：未读取的流式响应访问 .text/.content 会抛 ResponseNotRead。"""
    try:
        return getattr(obj, name, "")
    except Exception:  # noqa: BLE001
        return ""


def _error_detail(exc: Exception) -> tuple[int | None, str]:
    """取 HTTP 状态码与**原始响应体**——排查失败最要紧的信息，不能只给一句概述。"""
    response = getattr(exc, "response", None)
    status = getattr(exc, "status_code", None) or getattr(response, "status_code", None)
    body = ""
    if response is not None:
        for attr in ("text", "content"):
            value = _safe_attr(response, attr)
            if isinstance(value, (bytes, bytearray)):
                body = value.decode("utf-8", "replace")
            elif value:
                body = str(value)
            if body:
                break
    if not body:
        body = str(exc)
    return (int(status) if status else None), body[:2000]


@router.post("/api/llm-config/test")
def test_connection(req: LLMConfigUpdate, _user: str = Depends(get_current_user)):
    """用当前配置（∪ 本次请求值）发起最小请求，返回可排查的成功/失败细节。

    - 请求构造走协议族适配层：URL、请求体形状、认证头都由 profile + api_format 决定
    - 失败时返回 **HTTP 状态码 + 原始 error body + 最终请求 URL + 实际使用的 API 格式**
    - Mock 模式不调远程，按 api_format 返回对应的模拟响应结构

    ⚠️ 契约 ②：`from openai import ...` 必须在**函数体内**——测试通过 monkeypatch
    `openai.OpenAI` 拦截这条路径；改成模块级 import 会让 patch 静默失效（真发网络请求）。
    """
    from openai import APITimeoutError, OpenAI

    from ..config import get_settings
    from ..services.llm import describe_api_error
    from ..services.llm.dispatcher import resolve
    from ..services.llm.normalizer import merge_headers, mock_reply
    from ..services.llm.protocols.anthropic_msg import build_anthropic_client
    from ..services.llm.protocols.base import resolve_method
    from ..services.llm.url_builder import validate_base_url

    merged = _merged_test_config(req)
    settings = get_settings()
    profile = get_profile(str(merged.get("llm_provider") or ""))
    adapter, effective = resolve(profile, str(merged.get("llm_api_format") or "chat"))
    base_url = str(merged.get("llm_base_url") or settings.llm_base_url)
    api_key = str(merged.get("llm_api_key") or settings.llm_api_key)
    model = str(merged.get("llm_model") or settings.llm_model)

    invalid = validate_base_url(base_url)
    if invalid:
        return {"ok": False, "error": invalid, "code": "INVALID_BASE_URL", "api_format": effective}
    if not base_url.strip():
        return {
            "ok": False,
            "error": "请先填写 BaseURL（自定义预设没有默认地址）",
            "code": "NO_BASE_URL",
            "api_format": effective,
        }

    plan = adapter.build(
        profile=profile,
        model=model,
        system=TEST_SYSTEM,
        user=TEST_PROMPT,
        history=None,
        temperature=0,
        max_tokens=TEST_MAX_TOKENS,
    )

    # Mock 模式：不调远程，按 API 格式返回各自的模拟响应结构
    # 注意回退到 settings.llm_mode：运行时文件里可能根本没写 llm_mode（.env 才有时）
    if str(merged.get("llm_mode") or settings.llm_mode) != "real":
        return {
            "ok": True,
            "mock": True,
            "reply": MOCK_REPLY_TEXT,
            "model": model,
            "api_format": effective,
            "final_url": plan.final_url,
            "raw": mock_reply(effective, MOCK_REPLY_TEXT, model),
        }
    if not api_key:
        return {
            "ok": False,
            "error": "未配置 API Key：请在下方输入后点击「测试连接」",
            "code": "NO_KEY",
            "api_format": effective,
            "final_url": plan.final_url,
        }

    headers = merge_headers(effective, profile.header_overrides(effective))
    started = time.perf_counter()
    try:
        if effective == "anthropic":
            client = build_anthropic_client(
                api_key=api_key,
                base_url=base_url,
                timeout=20,
                auth=profile.auth(effective),
                headers=headers,
            )
        else:
            client = OpenAI(base_url=base_url, api_key=api_key, timeout=20, default_headers=headers)
        raw = resolve_method(client, plan.method)(**plan.kwargs)
    except APITimeoutError:
        return {
            "ok": False,
            "error": "请求超时（20s），请检查网络或 Base URL",
            "code": "TIMEOUT",
            "api_format": effective,
            "final_url": plan.final_url,
        }
    except Exception as exc:  # noqa: BLE001
        status, body = _error_detail(exc)
        return {
            "ok": False,
            "error": describe_api_error(exc),
            "code": type(exc).__name__,
            "status": status,
            "body": body,
            "api_format": effective,
            "final_url": plan.final_url,
        }
    reply = adapter.parse(raw)
    return {
        "ok": True,
        "reply": reply.text.strip()[:30],
        "model": reply.model or model,
        "latency_ms": int((time.perf_counter() - started) * 1000),
        "api_format": effective,
        "final_url": plan.final_url,
    }
