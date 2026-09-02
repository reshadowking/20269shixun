"""LLM 配置接口（API 配置页：前端直接配置 Key/供应商，立即生效，无需改 .env）。"""
import logging

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from ..llm_runtime import public_config, save_runtime_config
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


@router.post("/api/llm-config/test")
def test_connection(req: LLMConfigUpdate, _user: str = Depends(get_current_user)):
    """用给定配置（或当前生效配置）发起最小对话调用，返回成功/失败与错误码。"""
    from openai import APITimeoutError, OpenAI

    from ..services.llm import describe_api_error

    values = {k: v for k, v in req.model_dump(exclude_none=True).items() if k != "llm_mode"}
    if values:
        # 临时保存（测试通过后用户可再点保存固化）
        save_runtime_config(values)
    from ..llm_runtime import get_runtime_config

    cfg = get_runtime_config()
    from ..config import get_settings

    base_url = cfg.get("llm_base_url") or get_settings().llm_base_url
    api_key = cfg.get("llm_api_key") or get_settings().llm_api_key
    model = cfg.get("llm_model") or get_settings().llm_model
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
