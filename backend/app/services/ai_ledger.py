"""T21：把一次生成的模型调用记录落库（`ai_calls` 表）。

硬约束：
- **不含用户文本**——只记模型名、提示词版本哈希、token、耗时、成败与原因码；
- 记账失败**绝不影响生成**（整段 try/except → warning）；
- 用独立短会话写入，不占用请求级 `get_db` 连接。
"""
import logging
from datetime import UTC, datetime

from sqlalchemy import func, select

from ..config import get_settings
from ..db import SessionLocal
from ..models import AiCall

logger = logging.getLogger(__name__)

_FIELDS = ("kind", "model", "prompt_version", "tokens_in", "tokens_out", "latency_ms", "ok", "error_code", "fallback")


def record_calls(calls: list[dict] | None, session_key: str | None = None, user: str = "") -> int:
    """写入调用记录，返回写成功条数；任何异常都只记 warning。"""
    if not calls:
        return 0
    try:
        db = SessionLocal()
        try:
            db.add_all(
                [AiCall(session_key=session_key, user=user, **{k: c.get(k, "") for k in _FIELDS}) for c in calls]
            )
            db.commit()
            return len(calls)
        finally:
            db.close()
    except Exception as exc:  # noqa: BLE001 - 记账是旁路，不允许影响生成
        logger.warning("AI 调用记账失败（不影响生成）：%s", exc)
        return 0


def tokens_today(user: str | None = None) -> int:
    """当日（UTC）token 合计；`user=None` 表示全局。"""
    since = datetime.now(UTC).replace(hour=0, minute=0, second=0, microsecond=0)
    db = SessionLocal()
    try:
        stmt = select(func.coalesce(func.sum(AiCall.tokens_in + AiCall.tokens_out), 0)).where(AiCall.created_at >= since)
        if user is not None:
            stmt = stmt.where(AiCall.user == user)
        return int(db.execute(stmt).scalar_one() or 0)
    finally:
        db.close()


def quota_exceeded(user: str) -> str | None:
    """T22：当日 token 超限返回可读原因；**统计失败一律放行**（返回 None）。"""
    try:
        settings = get_settings()
        if settings.ai_daily_token_quota and tokens_today(None) >= settings.ai_daily_token_quota:
            return "今日 AI 用量已达上限，请明天再试"
        if settings.ai_daily_token_quota_per_user and tokens_today(user) >= settings.ai_daily_token_quota_per_user:
            return "今日 AI 用量已达上限，请明天再试"
    except Exception as exc:  # noqa: BLE001 - 统计问题不能挡住业务
        logger.warning("日配额统计失败（放行）：%s", exc)
    return None
