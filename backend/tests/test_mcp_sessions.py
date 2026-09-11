"""缺陷 4：MCP 工具的可选 session_id 校验与记账（跨会话工具调用被拒）。

不传 session_id 时与改造前行为完全一致（既有 test_mcp.py 已覆盖）。
"""
import pytest

from app.mcp_tools import (
    apply_design_edit,
    get_component_library,
    get_design_tokens,
    record_mcp_tool_call,
)

DESIGN = {"id": "root", "type": "frame", "style": {"layout": "column"}, "children": [{"id": "t", "type": "text", "props": {"text": "标题"}}]}


def _make_session(client, auth_headers, key: str) -> None:
    assert client.post("/api/sessions", json={"session_key": key}, headers=auth_headers).status_code == 200


class TestMcpSessionBinding:
    def test_tools_reject_unknown_session(self, client):
        """未知会话：工具调用被拒绝（不静默记账）。

        依赖 client fixture：应用 lifespan 里 init_db 才会建出会话表。
        """
        for call in (
            lambda: get_design_tokens(session_id="s-does-not-exist"),
            lambda: get_component_library(session_id="s-does-not-exist"),
            lambda: apply_design_edit(DESIGN, "把标题改大", session_id="s-does-not-exist"),
        ):
            with pytest.raises(ValueError, match="会话不存在"):
                call()

    def test_tool_calls_are_ledgered_to_session(self, client, auth_headers):
        _make_session(client, auth_headers, "s-mcp-ledger")
        assert get_design_tokens(session_id="s-mcp-ledger")["themes"]
        get_component_library(session_id="s-mcp-ledger")
        apply_design_edit(DESIGN, "把标题改大", session_id="s-mcp-ledger")

        calls = client.get("/api/sessions/s-mcp-ledger/tool-calls", headers=auth_headers).json()["tool_calls"]
        kinds = sorted(c["kind"] for c in calls)
        assert kinds == ["mcp:apply_design_edit", "mcp:get_component_library", "mcp:get_design_tokens"]
        assert all(c["source"] == "mcp" and c["ok"] is True for c in calls)

    def test_no_session_id_keeps_legacy_behavior(self):
        """不传 session_id：不碰数据库、行为与改造前一致。"""
        assert get_design_tokens()["themes"]
        assert get_component_library()["components"]
        result = apply_design_edit(DESIGN, "把标题改大")
        assert "design" in result and isinstance(result["fallback"], bool)

    def test_record_helper_rejects_unknown_session(self):
        with pytest.raises(ValueError, match="会话不存在"):
            record_mcp_tool_call("s-nope-mcp", "mcp:noop", True)
