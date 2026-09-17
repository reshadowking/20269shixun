"""MCP Server 冒烟（E5 + B2-3）：用官方 SDK 客户端连接 stdio server，验证 3 个工具可用。

用法（项目根目录，mock 环境即可跑通写工具降级路径）：
    backend/.venv/Scripts/python.exe scripts/mcp_smoke.py
"""
import asyncio
import json
import sys
from pathlib import Path

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

ROOT = Path(__file__).resolve().parent.parent

SAMPLE_DESIGN = {
    "id": "root",
    "type": "frame",
    "style": {"layout": "column", "gap": 8, "padding": 16, "width": 400},
    "children": [
        {"id": "b1", "type": "component", "componentType": "button", "props": {"text": "提交", "variant": "primary"}},
    ],
}


async def main() -> None:
    params = StdioServerParameters(
        command=sys.executable,
        args=[str(ROOT / "backend" / "mcp_server.py")],
        cwd=str(ROOT),
    )
    async with stdio_client(params) as (read, write), ClientSession(read, write) as session:
            await session.initialize()
            tools = await session.list_tools()
            names = [t.name for t in tools.tools]
            assert set(names) == {
                "get_design_tokens_tool",
                "get_component_library_tool",
                "apply_design_edit_tool",
            }, names
            print("tools:", names)

            r1 = await session.call_tool("get_design_tokens_tool", {})
            tokens = json.loads(r1.content[0].text)
            assert "colors" in tokens["themes"]["default"]
            print("tokens:", sorted(tokens["themes"]["default"].keys()),
                  "| colors:", len(tokens["themes"]["default"]["colors"]))

            r2 = await session.call_tool("get_component_library_tool", {})
            library = json.loads(r2.content[0].text)
            # 数量以**单一来源** shared/component-library.json 为准，不写死数字：
            # 本脚本原来写死 `== 15`，T9 把组件扩到 18（icon/switch/tabs）之后它就一直是红的
            # —— 同一个坑在 MCP 工具描述里也踩过一次（aaf1534）。
            expected_components = len(
                json.loads((ROOT / "shared" / "component-library.json").read_text(encoding="utf-8"))["components"]
            )
            assert len(library["components"]) == expected_components, (
                f"MCP 组件库 {len(library['components'])} 个 ≠ shared/component-library.json 的 {expected_components} 个"
            )
            print("components:", len(library["components"]), "| first:", library["components"][0]["type"])

            r3 = await session.call_tool(
                "apply_design_edit_tool",
                {"design": SAMPLE_DESIGN, "instruction": "把按钮改成红色"},
            )
            edited = json.loads(r3.content[0].text)
            assert edited["template"] == "edit"
            assert edited["design"]["children"][0]["id"] == "b1"
            print("apply_design_edit: fallback =", edited["fallback"],
                  "| design children =", len(edited["design"]["children"]))

    print("SMOKE OK")


if __name__ == "__main__":
    asyncio.run(main())
