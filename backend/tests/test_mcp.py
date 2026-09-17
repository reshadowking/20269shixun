"""MCP 工具测试（E5-1/E5-2 + B2-3）：令牌/组件库数据完整性、写工具 mock 路径、注册冒烟。"""

import asyncio
from typing import ClassVar

from app.design.validator import validate_design_safe
from app.mcp_tools import apply_design_edit, get_component_library, get_design_tokens
from app.services.beautify import preset_value


class TestDesignTokensTool:
    def test_returns_full_token_categories(self):
        """E5-1 验收：返回完整令牌 JSON，包含所有类别。"""
        tokens = get_design_tokens()
        themes = tokens["themes"]
        assert set(themes.keys()) == {"default", "dark"}
        colors = themes["default"]["colors"]
        assert "primary" in colors and "danger" in colors and "text-primary" in colors
        for theme in themes.values():
            assert "typography" in theme and "spacing" in theme and "radius" in theme
        assert tokens["themes"]["default"]["typography"]["heading"]["size"] == 24
        assert "allowed_hex_colors" in tokens

    def test_tokens_are_hex_values(self):
        colors = get_design_tokens()["themes"]["default"]["colors"]
        for name, value in colors.items():
            assert value.startswith("#"), f"{name} 应为 hex 值"


class TestComponentLibraryTool:
    def test_returns_18_components(self):
        """E5-2 验收 + T9：返回 18 个组件完整定义。"""
        library = get_component_library()
        comps = library["components"]
        assert len(comps) == 18
        assert all(c["type"] and c["name"] for c in comps)
        assert all("props" in c and "default_style" in c for c in comps)

    def test_types_match_ai_whitelist(self):
        whitelist = {
            "button", "card", "input", "select", "table", "chart", "stat-block",
            "navbar", "sidebar", "avatar", "tag", "divider", "title-text", "hero", "image",
            "icon", "switch", "tabs",
        }
        types = {c["type"] for c in get_component_library()["components"]}
        assert types == whitelist

    def test_key_components_have_props(self):
        comps = {c["type"]: c for c in get_component_library()["components"]}
        assert "text" in comps["button"]["props"]
        assert "links" in comps["navbar"]["props"]
        assert "data" in comps["chart"]["props"]
        assert comps["chart"]["props"]["chartType"]["enum"] == ["line", "bar", "pie"]


class TestMcpServerRegistration:
    def test_tools_registered(self):
        """FastMCP 实例注册了 3 个工具（stdio 冒烟由 scripts/mcp_smoke.py 覆盖）。"""
        import sys
        from pathlib import Path

        sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
        import importlib

        server = importlib.import_module("mcp_server")
        tools = asyncio.run(server.mcp.list_tools())
        names = {t.name for t in tools}
        assert names == {
            "get_design_tokens_tool",
            "get_component_library_tool",
            "apply_design_edit_tool",
        }

    def test_tool_descriptions_have_no_stale_component_count(self):
        """外部 Agent 读的就是工具描述：描述里写死的组件数量已经过期过两次（15 → 18）。

        现在描述不再写数字、以返回值为准；这条守门禁止再把"N 个组件/N 种组件类型"写回去，
        并顺带保证三个工具的 __doc__ 非空（f-string 当第一条语句不会成为 __doc__，实测会清空描述）。
        """
        import re
        import sys
        from pathlib import Path

        sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
        import importlib

        server = importlib.import_module("mcp_server")
        real = len(get_component_library()["components"])
        for fn in (server.get_design_tokens_tool, server.get_component_library_tool, server.apply_design_edit_tool):
            doc = fn.__doc__ or ""
            assert doc.strip(), f"{fn.__name__} 的 __doc__ 不能为空（MCP 工具描述）"
            claimed = re.findall(r"(\d+)\s*[个种]\s*组件", doc)
            assert not claimed, f"{fn.__name__} 描述里写死了组件数量 {claimed}，实际 {real}——改为不写数字"


class TestApplyDesignEditTool:
    SAMPLE: ClassVar[dict] = {
        "id": "root",
        "type": "frame",
        "style": {"layout": "column", "gap": 8, "padding": 16, "width": 400},
        "children": [
            {"id": "b1", "type": "component", "componentType": "button", "props": {"text": "提交", "variant": "primary"}},
        ],
    }

    def test_mock_mode_returns_deterministic_rewrite(self):
        """Mock/无 Key 模式（T4 前置起）：增量修改产出**确定性改写树**而非 fallback 原树。

        旧契约是"mock=兜底原树"（本用例曾断言 fallback=True）；T4 前置按任务卡
        变更 mock 行为：关键词规则改写、仍走 repair→Schema→合规流水线。本用例
        保留原保护意图——产物必须是合法 DesignNode、不丢用户数据——并把断言
        更新为新契约（确定性、效果值来自预置集合、无结构变更）。
        """
        result = apply_design_edit(self.SAMPLE, "把按钮改成红色")
        assert result["template"] == "edit"
        assert result["fallback"] is False  # T4 前置：mock 编辑不再兜底
        ok, errors = validate_design_safe(result["design"])
        assert ok, f"返回树不合法: {errors[:3]}"
        # 结构与用户数据不变（无 text 节点 → "改成"落空 → 默认施加"极轻"阴影）
        children = result["design"]["children"]
        assert children[0]["id"] == "b1" and children[0]["props"]["text"] == "提交"
        assert result["design"]["style"]["padding"] == 16
        assert children[0]["style"]["shadow"] == preset_value("shadow", "极轻")

    def test_result_fields_match_generate_api(self):
        """返回结构包含 /api/generate 同款字段（Agent 可直接保存/继续处理）。"""
        result = apply_design_edit(self.SAMPLE, "把标题改成「立即报名」")
        for key in ("design", "template", "compliance", "violations", "violations_detail", "fallback", "error"):
            assert key in result, f"缺返回字段 {key}"
