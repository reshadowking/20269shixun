"""T21：把一次生成的模型调用记录落库（`ai_calls` 表）。

硬约束：
- **不含用户文本**——只记模型名、提示词版本哈希、token、耗时、成败与原因码；
- 记账失败**绝不影响生成**（整段 try/except → warning）；
- 用独立短会话写入，不占用请求级 `get_db` 连接。
"""
import logging

from ..db import SessionLocal
from ..models import AiCall

logger = logging.getLogger(__name__)

_FIELDS = ("kind", "model", "prompt_version", "tokens_in", "tokens_out", "latency_ms", "ok", "error_code", "fallback")


def record_calls(calls: list[dict] | None, session_key: str | None = None) -> int:
    """写入调用记录，返回写成功条数；任何异常都只记 warning。"""
    if not calls:
        return 0
    try:
        db = SessionLocal()
        try:
            db.add_all([AiCall(session_key=session_key, **{k: c.get(k, "") for k in _FIELDS}) for c in calls])
            db.commit()
            return len(calls)
        finally:
            db.close()
    except Exception as exc:  # noqa: BLE001 - 记账是旁路，不允许影响生成
        logger.warning("AI 调用记账失败（不影响生成）：%s", exc)
        return 0
