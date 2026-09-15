"""MCP 工具实现（E5-1/E5-2）：设计令牌 + 组件库，供 MCP Server 与 pytest 直接调用。

数据源（单一来源）：
- shared/design-system.yaml → get_design_tokens
- shared/component-library.json → get_component_library

缺陷 4：三个工具都接受可选 session_id——
- 传入时会话必须存在，否则拒绝调用（未知/跨会话的工具调用被拒）；
- 存在则在该会话记一条工具调用（source=mcp），使"工具调用记录绑定会话"可审计。
不传 session_id 时行为与改造前完全一致（向后兼容）。
"""
import json
from functools import lru_cache
from pathlib import Path

import yaml
from sqlalchemy import select

from .db import SessionLocal
from .models import ChatSession
from .services import sessions as sessions_service

SHARED_DIR = Path(__file__).resolve().parent.parent.parent / "shared"
TOKENS_YAML = SHARED_DIR / "design-system.yaml"
LIBRARY_JSON = SHARED_DIR / "component-library.json"


@lru_cache(maxsize=1)
def load_design_tokens() -> dict:
    """读取 design-system.yaml，返回完整令牌 JSON（colors/typography/spacing/radius/motion 等全部类别）。"""
    with open(TOKENS_YAML, encoding="utf-8") as f:
        data = yaml.safe_load(f) or {}
    return data


@lru_cache(maxsize=1)
def load_component_library() -> dict:
    """读取 component-library.json，返回 18 个组件定义数组。"""
    with open(LIBRARY_JSON, encoding="utf-8") as f:
        return json.load(f)


def record_mcp_tool_call(session_id: str, kind: str, ok: bool) -> None:
    """可选会话记账（缺陷 4）：会话不存在则拒绝（跨会话/未知会话的工具调用被拒）。"""
    db = SessionLocal()
    try:
        session = db.execute(select(ChatSession).where(ChatSession.session_key == session_id)).scalars().first()
        if session is None:
            raise ValueError(f"会话不存在：{session_id}（拒绝未知会话的工具调用）")
        sessions_service.record_tool_call(db, session, kind, ok, source="mcp")
    finally:
        db.close()


def _with_session(session_id: str | None, kind: str, fn):
    """统一包装：传入 session_id 时先校验（不存在直接拒绝），执行后按成败记账。"""
    if session_id is None:
        return fn()
    record_mcp_tool_call(session_id, kind, ok=True)  # 校验 + 记录（不存在会抛 ValueError）
    try:
        return fn()
    except Exception:
        record_mcp_tool_call(session_id, kind, ok=False)
        raise


def get_design_tokens(session_id: str | None = None) -> dict:
    """MCP 工具：输出完整设计令牌 JSON（colors/typography/spacing/radius + 允许色列表）。"""
    return _with_session(session_id, "mcp:get_design_tokens", load_design_tokens)


def get_component_library(session_id: str | None = None) -> dict:
    """MCP 工具：输出 18 个组件定义数组（type/name/props 定义/default_style）。"""
    return _with_session(session_id, "mcp:get_component_library", load_component_library)


def apply_design_edit(design: dict, instruction: str, session_id: str | None = None) -> dict:
    """MCP 写工具（B2-3 轻量过渡版）：自然语言指令 + 当前设计树 → 增量编辑结果。

    复用生成链路增量分支（generate_design current_design=design），宽容修复 → Schema 校验 →
    令牌合规全套后处理自动生效，返回可保存的合法 DesignNode。
    登记口径（优化路线图 §1.3）：本工具是轻量过渡版，不代表 P1-6 已交付——正式 patch 版
    （结构化 patch / max_modify_nodes=5 / 禁 LLM 整树替换 / post_processor 统一入口）二期实现。
    Mock/无 Key 模式下 LLM 不可用，返回原树（fallback=True），与 /api/generate 语义一致。
    """
    from .services.generate import generate_design

    def _run() -> dict:
        result = generate_design(instruction, current_design=design)
        return {
            "design": result.design,
            "template": result.template,
            "compliance": result.compliance,
            "violations": result.violations,
            "violations_detail": result.violations_detail,
            "fallback": result.fallback,
            "error": result.error,
        }

    return _with_session(session_id, "mcp:apply_design_edit", _run)
