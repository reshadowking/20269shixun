"""LLM 运行时配置（前端 API 配置页保存，优先于 .env，立即生效无需重启）。

存储：backend/data/llm-config.json（.gitignore 已排除——API Key 绝不入 git）。
优先级：运行时配置（非空字段） > .env / 环境变量。
"""
import json
import logging
import os
import time
from functools import lru_cache
from pathlib import Path

from .config import get_settings
from .services.llm.profiles import (
    API_FORMAT_LABELS,
    match_profile,
    profiles_payload,
)
from .services.llm.url_builder import RESERVED_PATH_MESSAGE, RESERVED_PATH_SUFFIXES

logger = logging.getLogger(__name__)

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
# T10.2：配置文件路径允许环境变量覆盖（LLM_CONFIG_FILE）——测试/E2E 的 mock 隔离
# 不再依赖「启动包装器改模块常量」（docs/AI后续优化与测试提示词.md §1 的正确做法），
# 一句 `LLM_CONFIG_FILE=/tmp/none.json` 即可让运行时配置回到"无文件"状态。
# 未设置时保持默认 backend/data/llm-config.json。
CONFIG_FILE = Path(os.environ.get("LLM_CONFIG_FILE") or (DATA_DIR / "llm-config.json"))

# 允许前端覆盖的字段（白名单，防止写入任意键）
RUNTIME_KEYS = (
    "llm_mode",
    "llm_base_url",
    "llm_api_key",
    "llm_model",
    "llm_backup_model",
    "llm_timeout_seconds",
    "llm_max_tokens",
    # T48：供应商预设与 API 格式（纯新增，老配置缺这两个字段走读侧反推）
    "llm_provider",
    "llm_api_format",
)

# T34：档案（profile）里每个档案可覆盖的字段（不含 llm_mode / llm_max_tokens，它们是全局设置）
PROFILE_KEYS = (
    "llm_base_url",
    "llm_api_key",
    "llm_model",
    "llm_backup_model",
    "llm_timeout_seconds",
    "llm_provider",
    "llm_api_format",
)
DEFAULT_PROFILE_ID = "default"
DEFAULT_PROVIDER = "custom"
DEFAULT_API_FORMAT = "chat"

# 旧键保留为**不渲染的别名**（只增不删：老前端 bundle 读 providers.moonshot 仍然能拿到）
LEGACY_PROVIDER_ALIASES = {"moonshot": "kimi"}

# 供应商预设（前端下拉快捷填充）
PROVIDERS = {
    "deepseek": {"name": "DeepSeek", "base_url": "https://api.deepseek.com/v1", "model": "deepseek-chat"},
    "qwen": {"name": "通义千问 Qwen", "base_url": "https://dashscope.aliyuncs.com/compatible-mode/v1", "model": "qwen-plus"},
    "moonshot": {"name": "Kimi Moonshot", "base_url": "https://api.moonshot.cn/v1", "model": "moonshot-v1-8k"},
}


@lru_cache(maxsize=1)
def _read_raw() -> dict:
    """读原始文件（兼容旧扁平结构与新 profiles 结构）。"""
    try:
        if CONFIG_FILE.exists():
            data = json.loads(CONFIG_FILE.read_text(encoding="utf-8"))
            if isinstance(data, dict):
                return data
    except (OSError, json.JSONDecodeError) as exc:
        logger.warning("读取 llm-config.json 失败: %s", exc)
    return {}


def _normalize(raw: dict) -> dict:
    """归一为 {active, profiles[], llm_mode, llm_max_tokens}。

    T34 向后兼容：旧文件是**扁平**的（llm_base_url/llm_model/... 直接在顶层），
    这里自动包装成单个档案（id=default，名称「默认配置」）并设为 active——老用户零迁移。
    """
    global_keys = {k: v for k, v in raw.items() if k in ("llm_mode", "llm_max_tokens") and v not in (None, "")}
    profiles = raw.get("profiles")
    if isinstance(profiles, list) and profiles:
        cleaned = []
        for item in profiles:
            if not isinstance(item, dict):
                continue
            pid = str(item.get("id") or "").strip()
            if not pid:
                continue
            profile = {"id": pid, "name": str(item.get("name") or pid)}
            for key in PROFILE_KEYS:
                value = item.get(key)
                if value not in (None, ""):
                    profile[key] = value
            cleaned.append(profile)
        if cleaned:
            active = str(raw.get("active") or cleaned[0]["id"])
            if active not in {p["id"] for p in cleaned}:
                active = cleaned[0]["id"]
            return {**global_keys, "active": active, "profiles": cleaned}

    legacy = {k: v for k, v in raw.items() if k in PROFILE_KEYS and v not in (None, "")}
    return {
        **global_keys,
        "active": DEFAULT_PROFILE_ID,
        "profiles": [{"id": DEFAULT_PROFILE_ID, "name": "默认配置", **legacy}],
    }


def _with_target(flat: dict) -> dict:
    """补全 llm_provider / llm_api_format（T48 读侧迁移，**不写盘**）。

    老档案没有这两个字段：按归一化 base_url 反推预设与格式——现网 Kimi 档案由此自动
    拿到参数剔除策略（否则 temperature 400 修不掉）；反推不中就回落 custom + chat。

    只补这两个字段，不动 base_url / model / api_key。写回后下次直读字段，不再反推。
    """
    if not flat.get("llm_provider"):
        matched = match_profile(str(flat.get("llm_base_url") or ""))
        flat["llm_provider"] = matched[0] if matched else DEFAULT_PROVIDER
        if matched and not flat.get("llm_api_format"):
            flat["llm_api_format"] = matched[1]
    if not flat.get("llm_api_format"):
        flat["llm_api_format"] = DEFAULT_API_FORMAT
    return flat


def get_runtime_config() -> dict:
    """返回当前生效的运行时配置（扁平结构，脱敏由调用方处理）。

    T34：内部改为"档案"存储，但对上层仍是**扁平键**——`LLMClient.cfg("llm_model")` 等调用方
    一字未改；`llm_mode` / `llm_max_tokens` 为全局设置，不随档案切换。
    """
    data = _normalize(_read_raw())
    active = data["active"]
    profile = next((p for p in data["profiles"] if p["id"] == active), data["profiles"][0])
    flat = {k: v for k, v in data.items() if k in ("llm_mode", "llm_max_tokens")}
    flat.update({k: v for k, v in profile.items() if k in PROFILE_KEYS})
    return _with_target(flat)


# 兼容别名（T34）：测试与既有调用方会访问 `_load_from_disk.cache_clear()`，
# 重命名为 `_read_raw` 后必须保留同名引用，否则夹具直接 AttributeError（曾导致全量 ERROR）。
_load_from_disk = _read_raw


def list_profiles() -> dict:
    """T34：全部档案 + 当前生效 id（Key 由调用方脱敏）。"""
    data = _normalize(_read_raw())
    return {"active": data["active"], "profiles": data["profiles"]}


def _write(data: dict) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    CONFIG_FILE.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    _read_raw.cache_clear()


def save_profile(values: dict, profile_id: str | None = None, name: str | None = None) -> dict:
    """T34：保存/新建一个档案，并把它设为当前生效。返回归一后的全量数据。"""
    data = _normalize(_read_raw())
    pid = (profile_id or "").strip() or f"p-{int(time.time() * 1000) % 10**8}"
    current = next((p for p in data["profiles"] if p["id"] == pid), None)
    if current is None:
        current = {"id": pid, "name": (name or "自定义配置").strip() or "自定义配置"}
        data["profiles"].append(current)
    if name and name.strip():
        current["name"] = name.strip()
    for key in PROFILE_KEYS:
        if key not in values:
            continue
        value = values[key]
        if value is None or (isinstance(value, str) and not value.strip()):
            continue
        if key == "llm_api_key" and is_masked_key(str(value)):
            continue  # 脱敏回写会覆盖真实 Key（P0-2 防呆）
        current[key] = float(value) if key == "llm_timeout_seconds" else value
    for key in ("llm_mode", "llm_max_tokens"):
        value = values.get(key)
        if value in (None, ""):
            continue
        data[key] = int(value) if key == "llm_max_tokens" else value
    data["active"] = pid
    _write(data)
    logger.info("LLM 档案已保存：%s（active=%s）", current.get("name"), pid)
    return data


def activate_profile(profile_id: str) -> dict | None:
    """切换当前生效档案；档案不存在返回 None。"""
    data = _normalize(_read_raw())
    if profile_id not in {p["id"] for p in data["profiles"]}:
        return None
    data["active"] = profile_id
    _write(data)
    return data


def delete_profile(profile_id: str) -> bool:
    """删除档案（至少保留一个；删除当前生效档案时自动切到第一个）。"""
    data = _normalize(_read_raw())
    remaining = [p for p in data["profiles"] if p["id"] != profile_id]
    if not remaining or len(remaining) == len(data["profiles"]):
        return False
    data["profiles"] = remaining
    if data["active"] == profile_id:
        data["active"] = remaining[0]["id"]
    _write(data)
    return True


def save_runtime_config(values: dict) -> dict:
    """保存运行时配置（只保留白名单字段，空值不覆盖已存值）。返回保存后的完整配置。"""
    # T34：老入口（POST /api/llm-config）语义不变——写入**当前生效档案**（不新建档案）
    active = _normalize(_read_raw())["active"]
    return save_profile(values, profile_id=active, name=values.get("name"))


def mask_api_key(key: str) -> str:
    """脱敏：sk-abc12345 → sk-****2345（只留前缀和后 4 位）。"""
    if not key:
        return ""
    if len(key) <= 8:
        return "*" * len(key)
    return f"{key[:3]}****{key[-4:]}"


def is_masked_key(key: str) -> bool:
    """判断是否为脱敏后的 key（mask_api_key 产物含固定 ****）。

    脱敏值只用于回显，绝不能回写磁盘——否则会覆盖真实 Key（保存/测试接口共用防呆）。
    """
    return "****" in key


def _providers_payload() -> dict:
    """供应商预设表（下发前端）。

    既有三键 `name` / `base_url` / `model` 原样保留（老前端 bundle 仍能跑），
    T48 新增字段由 profiles.provider_payload 提供；旧键（moonshot）保留为
    **不渲染的别名**——只增不删，前端按 `deprecated` 跳过。
    """
    payload = profiles_payload()
    for legacy_id, current_id in LEGACY_PROVIDER_ALIASES.items():
        if current_id in payload:
            payload[legacy_id] = {**payload[current_id], "deprecated": True}
    return payload


# 兼容既有引用（llm_runtime.PROVIDERS）
PROVIDERS = _providers_payload()


def public_config() -> dict:
    """对外可见配置（Key 脱敏）+ 供应商预设 + 前端即时校验所需的数据。"""
    cfg = get_runtime_config()
    merged = {key: getattr(get_settings(), key) for key in RUNTIME_KEYS}
    merged.update(cfg)
    merged["llm_api_key"] = mask_api_key(merged.get("llm_api_key") or "")
    merged["providers"] = _providers_payload()
    # 前端即时校验用：名单与文案都由后端下发，前端不持有任何规则副本
    merged["reserved_path_suffixes"] = list(RESERVED_PATH_SUFFIXES)
    merged["reserved_path_message"] = RESERVED_PATH_MESSAGE
    merged["api_format_labels"] = dict(API_FORMAT_LABELS)
    return merged
