"""T24：把会话历史接进生成链路。

设计取舍（与 T24 任务卡一致）：
- 只取最近 `max_turns` 轮（默认 2），`user` 轮用**指令原文**——"你原话怎么说的"是模型最需要的信息；
- `assistant` 轮**不放回执原文**（现在是模板字符串，喂回去会自我强化污染），改为一行**机器摘要**
  （如"已按指令修改画布"），来源是前端在写回执前先落的 `session_tool_calls` 记录；
- 无会话 / 越权 / 查不到 → 返回 `[]`（生成行为与"没有历史"完全一致，零回归）；
- 按 `llm_history_max_chars` 从**最旧一轮**开始丢；单轮超预算时截断该轮内容。

已知限制：`session_tool_calls` 与消息之间用时间先后匹配（前端先记账、后写回执），
不是严格的外键关联；并发多轮时可能配错一轮（窗口只有 2 轮，影响有限）。
"""
import logging

from sqlalchemy.orm import Session as DbSession

from ..config import get_settings
from ..models import SessionToolCall
from . import sessions as sessions_service

logger = logging.getLogger(__name__)

# 前端记账 kind（AIChatPanel.recordToolCall）→ 机器摘要；带 `:` 的复合 kind 取前缀
_TOOL_SUMMARY = {
    "generate": "已生成一版设计稿",
    "incremental-edit": "已按指令修改画布",
    "explore": "已给出两个备选方案",
}
_DEFAULT_SUMMARY = "已完成一次操作"


def _summary_of(kind: str | None, ok: bool | None) -> str:
    text = _TOOL_SUMMARY.get((kind or "").split(":")[0], _DEFAULT_SUMMARY)
    return f"{text}（失败）" if ok is False else text


def _matched_call(calls: list[SessionToolCall], message_created_at) -> SessionToolCall | None:
    """取"该回执之前最近的一次生成类记账"作为该轮的机器摘要来源。"""
    matched: SessionToolCall | None = None
    for call in calls:  # 按 id 升序
        if call.kind.split(":")[0] not in _TOOL_SUMMARY:
            continue  # 追问/效果等记账不代表"生成结果"，跳过
        if call.created_at is None or message_created_at is None or call.created_at <= message_created_at:
            matched = call
        else:
            break
    return matched


def _trim(turns: list[dict]) -> list[dict]:
    """按字符预算保留最新的若干轮（从最旧开始丢；单轮超预算时截断该轮）。

    预算完全尊重 `llm_history_max_chars`（≤0 视为"不带历史"），不做内部下限——
    否则配置成小值会被静默放大，测试与调参都会失去意义。
    """
    budget = int(get_settings().llm_history_max_chars)
    if budget <= 0:
        return []
    kept: list[dict] = []
    used = 0
    for turn in reversed(turns):
        if used >= budget:
            break
        content = turn["content"]
        room = budget - used
        if len(content) > room:
            content = content[:room] + "…"
        kept.append({"role": turn["role"], "content": content})
        used += len(content)
    return list(reversed(kept))


def recent_turns(db: DbSession, session_key: str | None, owner: str, max_turns: int = 2) -> list[dict]:
    """返回 [{"role": "user"|"assistant", "content": str}, …]（最多 max_turns 轮，最旧在前）。"""
    if not session_key:
        return []
    owner_id = sessions_service.owner_id_of(db, owner)
    if owner_id is None:
        return []
    session = sessions_service.get_owned_session(db, owner_id, session_key)
    if session is None:
        return []

    limit = max(1, min(max_turns, 5)) * 2
    messages = sessions_service.list_messages(db, session, limit=limit)
    calls = sorted(sessions_service.list_tool_calls(db, session, limit=50), key=lambda c: c.id)

    turns: list[dict] = []
    for message in messages:
        if message.role == "user":
            turns.append({"role": "user", "content": message.content})
            continue
        call = _matched_call(calls, message.created_at)
        turns.append({"role": "assistant", "content": _summary_of(call.kind if call else None, call.ok if call else None)})
    return _trim(turns)
