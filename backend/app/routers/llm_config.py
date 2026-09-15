"""LLM 配置接口（API 配置页：前端直接配置 Key/供应商，立即生效，无需改 .env）。"""
import logging

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from ..llm_runtime import (
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

logger = logging.getLogger(__name__)
router = APIRouter(tags=["llm-config"])


class LLMConfigUpdate(BaseModel):
    llm_mode: str | None = Field(default=None, max_length=20)
    llm_base_url: str | None = Field(default=None, max_length=200)
    llm_api_key: str | None = Field(default=None, max_length=200)
    llm_model: str | None = Field(default=None, max_length=100)
    llm_backup_model: str | None = Field(default=None, max_length=100)
    llm_timeout_seconds: float | None = Field(default=None, ge=10, le=300)
    llm_max_tokens: int | None = Field(default=None, ge=1024, le=65536)


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


@router.post("/api/llm-config/test")
def test_connection(req: LLMConfigUpdate, _user: str = Depends(get_current_user)):
    """用给定配置（或当前生效配置）发起最小对话调用，返回成功/失败与错误码。

    不落盘：测试用配置 = 当前生效配置 ∪ 本次请求值（内存合并）；
    请求中的脱敏 key（含 ****）一律忽略，防止把回显值当真实 Key 测试/写坏。
    """
    from openai import APITimeoutError, OpenAI

    from ..llm_runtime import get_runtime_config
    from ..services.llm import describe_api_error

    merged = dict(get_runtime_config())
    for key, value in req.model_dump(exclude_none=True).items():
        if key not in ("llm_base_url", "llm_api_key", "llm_model"):
            continue
        if value is None or (isinstance(value, str) and not value.strip()):
            continue
        if key == "llm_api_key" and is_masked_key(str(value)):
            continue  # 脱敏值不参与测试，使用已保存的真实 Key
        merged[key] = value
    from ..config import get_settings

    base_url = merged.get("llm_base_url") or get_settings().llm_base_url
    api_key = merged.get("llm_api_key") or get_settings().llm_api_key
    model = merged.get("llm_model") or get_settings().llm_model
    if not api_key:
        return {"ok": False, "error": "未配置 API Key：请在下方输入后点击「测试连接」", "code": "NO_KEY"}
    client = OpenAI(base_url=base_url, api_key=api_key, timeout=20)
    try:
        resp = client.chat.completions.create(
            model=model,
            messages=[{"role": "user", "content": "你好，请回复：连接成功"}],
            max_tokens=16,
            temperature=0,
        )
        reply = (resp.choices[0].message.content or "").strip()[:30]
        return {"ok": True, "reply": reply, "model": getattr(resp, "model", model)}
    except APITimeoutError:
        return {"ok": False, "error": "请求超时（20s），请检查网络或 Base URL", "code": "TIMEOUT"}
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": describe_api_error(exc), "code": type(exc).__name__}
