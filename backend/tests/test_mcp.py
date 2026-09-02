"""MCP 工具测试（E5-1/E5-2）：令牌与组件库数据完整性 + FastMCP 工具注册冒烟。"""

import asyncio

from app.mcp_tools import get_component_library, get_design_tokens


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
    def test_returns_15_components(self):
        """E5-2 验收：返回 15 个组件完整定义。"""
        library = get_component_library()
        comps = library["components"]
        assert len(comps) == 15
        assert all(c["type"] and c["name"] for c in comps)
        assert all("props" in c and "default_style" in c for c in comps)

    def test_types_match_ai_whitelist(self):
        whitelist = {
            "button", "card", "input", "select", "table", "chart", "stat-block",
            "navbar", "sidebar", "avatar", "tag", "divider", "title-text", "hero", "image",
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
        """FastMCP 实例注册了 2 个工具（stdio 冒烟由配置文档覆盖）。"""
        import sys
        from pathlib import Path

        sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
        import importlib

        server = importlib.import_module("mcp_server")
        tools = asyncio.run(server.mcp.list_tools())
        names = {t.name for t in tools}
        assert names == {"get_design_tokens_tool", "get_component_library_tool"}
