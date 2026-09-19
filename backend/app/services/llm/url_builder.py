"""BaseURL 规范化与校验（协议族无关，零依赖）。

T48 最关键的一条约定：**路径后缀由 SDK 自己拼**——openai SDK 会拼
`/chat/completions` 或 `/responses`，anthropic SDK 会拼 `/v1/messages`。

所以本模块**不参与请求构造**，只做两件事：

1. 校验用户填的 BaseURL 没把路径后缀写进去（写进去 → SDK 再拼一次 → 双后缀 404）
2. 为展示与诊断派生"最终请求 URL"

反例（会让 URL 变成 `.../chat/completions/chat/completions`）：
    base_url = normalize(base_url) + normalize_path_suffix(path)   # ← 禁止这样构造请求

`RESERVED_PATH_SUFFIXES` 是这份名单的唯一硬编码源，随 `/api/llm-config` 下发给
前端做即时校验——前端因此不需要持有任何规则副本。
"""
RESERVED_PATH_SUFFIXES: tuple[str, ...] = ("/chat/completions", "/responses", "/messages")

RESERVED_PATH_MESSAGE = "BaseURL 不应包含路径后缀"


def normalize_base_url(base_url: str) -> str:
    """去首尾空白与末尾斜杠（保留 scheme 与路径）。"""
    return (base_url or "").strip().rstrip("/")


def normalize_path_suffix(path_suffix: str) -> str:
    """保证以 `/` 开头（空值返回空串）。"""
    suffix = (path_suffix or "").strip()
    if not suffix:
        return ""
    return suffix if suffix.startswith("/") else "/" + suffix


def find_reserved_suffix(base_url: str) -> str | None:
    """返回命中的禁用后缀（未命中返回 None）。"""
    candidate = normalize_base_url(base_url)
    for suffix in RESERVED_PATH_SUFFIXES:
        if suffix in candidate:
            return suffix
    return None


def validate_base_url(base_url: str) -> str | None:
    """校验 BaseURL：合法返回 None，非法返回中文原因。

    空值视为合法（自定义预设默认就是空的）；"是否必填"由调用方决定，
    本函数只管"填了就不能带路径后缀"。
    """
    if not (base_url or "").strip():
        return None
    hit = find_reserved_suffix(base_url)
    if hit:
        return f"{RESERVED_PATH_MESSAGE}（检测到 {hit}）"
    return None


def derive_final_url(base_url: str, path_suffix: str) -> str | None:
    """派生展示/诊断用的最终 URL；base 为空返回 None（不是空串）。

    返回 None 而不是 ""：空串会被界面误当成"后端算出来就是空"，
    None 才能表达"这个预设没有默认地址"。
    """
    base = normalize_base_url(base_url)
    if not base:
        return None
    return base + normalize_path_suffix(path_suffix)
