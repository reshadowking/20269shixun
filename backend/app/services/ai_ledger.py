"""T21：把一次生成的模型调用记录落库（`ai_calls` 表）。

硬约束：
- **不含用户文本**——只记模型名、提示词版本哈希、token、耗时、成败与原因码；
- 记账失败**绝不影响生成**（整段 try/except → warning）；
- 用独立短会话写入，不占用请求级 `get_db` 连接。

2026-09-18 修（线上暴露）：`error_code` 列是 `varchar(64)`，而 `describe_api_error`
最长约 129 字符（`HTTP 401 ` + message[:120]）。Postgres 会抛
`StringDataRightTruncation`，而 `record_calls` 是**一次 add_all + 一次 commit**——
任一行超长即**整批回滚**，一次生成的主模型 + 备用模型记录全丢。
最要命的是：超长错误恰恰来自"带完整 error body 的 401/429"，也就是最该被记录的场景。

⚠️ **SQLite 不校验 VARCHAR 长度**，所以 800 条测试全绿也发现不了，只有 Postgres 才暴露。
因此写入前必须自己按列宽截断（见 `_fit`），且回归测试要直接断言截断后的值。
"""
import logging
import re
from collections import OrderedDict
from datetime import UTC, datetime

from sqlalchemy import func, select

from ..config import get_settings
from ..db import SessionLocal
from ..logging_config import GAP_DETAIL_LOGGER_NAME
from ..models import AiCall, AiCapabilityGap

logger = logging.getLogger(__name__)
gap_detail_logger = logging.getLogger(GAP_DETAIL_LOGGER_NAME)

_FIELDS = ("kind", "model", "prompt_version", "tokens_in", "tokens_out", "latency_ms", "ok", "error_code", "fallback")


def _column_limits() -> dict[str, int]:
    """从模型自身读列宽（**不手写常量**，避免与 models.py 漂移）。"""
    limits: dict[str, int] = {}
    for name in _FIELDS:
        column = AiCall.__table__.columns.get(name)
        length = getattr(getattr(column, "type", None), "length", None)
        if isinstance(length, int) and length > 0:
            limits[name] = length
    return limits


_COLUMN_LIMITS = _column_limits()


def _fit(name: str, value):
    """按列宽截断字符串；只对被截断的值记 warning（完整内容留在日志里可排查）。"""
    limit = _COLUMN_LIMITS.get(name)
    if not isinstance(value, str) or not limit or len(value) <= limit:
        return value
    logger.warning(
        "ai_calls.%s 超长（%d > %d），已截断写入；完整内容：%s", name, len(value), limit, value
    )
    return value[:limit]


def record_calls(calls: list[dict] | None, session_key: str | None = None, user: str = "") -> int:
    """写入调用记录，返回写成功条数；任何异常都只记 warning。"""
    if not calls:
        return 0
    try:
        db = SessionLocal()
        try:
            db.add_all(
                [
                    AiCall(session_key=session_key, user=user, **{k: _fit(k, c.get(k, "")) for k in _FIELDS})
                    for c in calls
                ]
            )
            db.commit()
            return len(calls)
        finally:
            db.close()
    except Exception as exc:  # noqa: BLE001 - 记账是旁路，不允许影响生成
        logger.warning("AI 调用记账失败（不影响生成）：%s", exc)
        return 0


# ---- T52：能力缺口台账（ai_capability_gaps 表）----

_GAP_FIELDS = ("gap_type", "detail", "node_id", "llm_model", "prompt_version", "profile_id", "api_format")

# detail/node_id 的净化红线（单个审查点，全类型统一）：两者的值都来自**模型产物**——
# 自创组件名、自创 props 键、模型给的节点 id——可能夹带用户意图文本（实测方向：AI 自创
# 中文键名 props.用户备注）。只保留标识符字符（含 ":"——detail 的命名空间前缀如 "ops:"），
# 其余连续段折叠为 <non-ascii>；完整原文只落专用日志 capability_gap_detail.log
# （本地 RotatingFileHandler 10MB×5，无第三方流向，见 logging_config.py）。
_SANITIZE_SAFE = re.compile(r"[^A-Za-z0-9_.:\-]+")

# 原文日志的 LRU 去重（512 键）：同一 (gap_type, detail) 只在**首次**遇到时写原文行，避免一次
# 大规模故障（如新提示词上线后整批 unknown_prop）把 10MB 滚走。进程重启后集合清零、首见重记
# 一次——可接受的 trade-off，**不做持久化**（那是给生产问题找假想需求）。淘汰后重现会再记，
# 有界。node_id 的完整语义：
#   - 日志 = 该 (gap_type, detail) **首见实例的原文**；
#   - DB = 每次出现一行、node_id 为净化值；
#   - 同一 detail 在后续节点上的 node_id 原文**两边都不留**——如需保全可扩 LRU 键为三元组
#     （当前不扩展：泄漏面最小 + 日志量可控的权衡）。
_SEEN_GAP_ORIGINALS_MAX = 512
_SEEN_GAP_ORIGINALS: "OrderedDict[str, None]" = OrderedDict()


def _log_gap_originals(gaps: list[dict], session_key: str | None, user: str) -> None:
    """原文旁路：DB 只存净化值，排查用的完整原文落 capability_gap_detail.log（首见去重）。

    独立 try/except：日志失败与 DB 失败互不影响，更不影响生成。
    """
    try:
        fresh = []
        for g in gaps:
            gap_type = str(g.get("gap_type", ""))
            detail = str(g.get("detail", ""))
            key = f"{gap_type}\x1f{detail}"
            if key in _SEEN_GAP_ORIGINALS:
                _SEEN_GAP_ORIGINALS.move_to_end(key)
                continue
            _SEEN_GAP_ORIGINALS[key] = None
            while len(_SEEN_GAP_ORIGINALS) > _SEEN_GAP_ORIGINALS_MAX:
                _SEEN_GAP_ORIGINALS.popitem(last=False)
            fresh.append(g)
        for g in fresh:
            gap_detail_logger.info(
                "gap_type=%s detail=%r node_id=%r session=%s user=%s",
                g.get("gap_type", ""),
                str(g.get("detail", "")),
                str(g.get("node_id", "")),
                session_key,
                user,
            )
    except Exception as exc:  # noqa: BLE001 - 日志是旁路，不允许影响生成
        logger.warning("缺口原文日志写入失败（不影响生成）：%s", exc)

def _gap_column_limits() -> dict[str, int]:
    """从模型自身读列宽（**不手写常量**，避免与 models.py 漂移）——同 _column_limits 模式。"""
    limits: dict[str, int] = {}
    for name in _GAP_FIELDS:
        column = AiCapabilityGap.__table__.columns.get(name)
        length = getattr(getattr(column, "type", None), "length", None)
        if isinstance(length, int) and length > 0:
            limits[name] = length
    return limits


_GAP_COLUMN_LIMITS = _gap_column_limits()


def _sanitize_detail(value: str) -> str:
    """T52 隐私红线的技术保证：非标识符字符折叠为 <non-ascii>，净化后为空记 <unspecified>。

    截断不在这里做（_fit_gap 按列宽统一截）——这里只负责"什么字符允许进 DB"。
    """
    cleaned = _SANITIZE_SAFE.sub("<non-ascii>", value).strip("-. ")
    return cleaned or "<unspecified>"


def _fit_gap(name: str, value):
    """按列宽截断；SQLite 不校验 VARCHAR 长度，截断必须在 Python 层做（同 ai_calls 教训）。"""
    limit = _GAP_COLUMN_LIMITS.get(name)
    if not isinstance(value, str) or not limit or len(value) <= limit:
        return value
    logger.warning("ai_capability_gaps.%s 超长（%d > %d），已截断写入；完整内容：%s", name, len(value), limit, value)
    return value[:limit]


def _gap_row_to_columns(g: dict) -> dict:
    """单行 → 列字典：detail/node_id 先净化再截断；空值保持空串（空值无泄漏面，不造占位符）。"""
    out: dict[str, str] = {}
    for k in _GAP_FIELDS:
        v = g.get(k, "")
        if k in ("detail", "node_id") and v:
            v = _sanitize_detail(v)
        out[k] = _fit_gap(k, v)
    return out


def record_capability_gaps(gaps: list[dict] | None, session_key: str | None = None, user: str = "") -> int:
    """T52：写能力缺口台账，返回写成功条数；任何异常都只记 warning（旁路，不影响生成）。

    归因口径：gap 的产生时刻在最后一次模型调用完成之后（repair 只处理 fill 产物），所以
    归因取 calls[-1] 是准确的；**未来若加多轮生成（一次请求多次产出设计）必须回来重审**。
    """
    if not gaps:
        return 0
    _log_gap_originals(gaps, session_key, user)
    try:
        db = SessionLocal()
        try:
            db.add_all(
                [
                    AiCapabilityGap(session_key=session_key, user=user, **_gap_row_to_columns(g))
                    for g in gaps
                ]
            )
            db.commit()
            return len(gaps)
        finally:
            db.close()
    except Exception as exc:  # noqa: BLE001 - 记账是旁路，不允许影响生成
        logger.warning("能力缺口记账失败（不影响生成）：%s", exc)
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
