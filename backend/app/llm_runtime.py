"""LLM 运行时配置（前端 API 配置页保存，优先于 .env，立即生效无需重启）。

存储：backend/data/llm-config.json（.gitignore 已排除——API Key 绝不入 git）。
优先级：运行时配置（非空字段） > .env / 环境变量。
"""
import json
import logging
from functools import lru_cache
from pathlib import Path

from .config import get_settings

logger = logging.getLogger(__name__)

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
CONFIG_FILE = DATA_DIR / "llm-config.json"

# 允许前端覆盖的字段（白名单，防止写入任意键）
RUNTIME_KEYS = (
    "llm_mode",
    "llm_base_url",
    "llm_api_key",
    "llm_model",
    "llm_backup_model",
    "llm_timeout_seconds",
    "llm_max_tokens",
)

# 供应商预设（前端下拉快捷填充）
PROVIDERS = {
    "deepseek": {"name": "DeepSeek", "base_url": "https://api.deepseek.com/v1", "model": "deepseek-chat"},
    "qwen": {"name": "通义千问 Qwen", "base_url": "https://dashscope.aliyuncs.com/compatible-mode/v1", "model": "qwen-plus"},
    "moonshot": {"name": "Kimi Moonshot", "base_url": "https://api.moonshot.cn/v1", "model": "moonshot-v1-8k"},
}


@lru_cache(maxsize=1)
def _load_from_disk() -> dict:
    try:
        if CONFIG_FILE.exists():
            data = json.loads(CONFIG_FILE.read_text(encoding="utf-8"))
            if isinstance(data, dict):
                return {k: v for k, v in data.items() if k in RUNTIME_KEYS and v not in (None, "")}
    except (OSError, json.JSONDecodeError) as exc:
        logger.warning("读取 llm-config.json 失败: %s", exc)
    return {}


def get_runtime_config() -> dict:
    """返回当前生效的运行时配置（脱敏由调用方处理）。"""
    return dict(_load_from_disk())


def save_runtime_config(values: dict) -> dict:
    """保存运行时配置（只保留白名单字段，空值不覆盖已存值）。返回保存后的完整配置。"""
    data = get_runtime_config()
    for key, value in values.items():
        if key not in RUNTIME_KEYS:
            continue
        if value is None or (isinstance(value, str) and not value.strip()):
            continue
        if key == "llm_timeout_seconds":
            value = float(value)
        elif key == "llm_max_tokens":
            value = int(value)
        data[key] = value
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    CONFIG_FILE.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    _load_from_disk.cache_clear()
    logger.info("LLM 运行时配置已更新（%s）", ", ".join(data.keys()))
    return dict(data)


def mask_api_key(key: str) -> str:
    """脱敏：sk-abc12345 → sk-****2345（只留前缀和后 4 位）。"""
    if not key:
        return ""
    if len(key) <= 8:
        return "*" * len(key)
    return f"{key[:3]}****{key[-4:]}"


def public_config() -> dict:
    """对外可见配置（Key 脱敏）+ 供应商预设。"""
    cfg = get_runtime_config()
    merged = {key: getattr(get_settings(), key) for key in RUNTIME_KEYS}
    merged.update(cfg)
    merged["llm_api_key"] = mask_api_key(merged.get("llm_api_key") or "")
    merged["providers"] = PROVIDERS
    return merged
