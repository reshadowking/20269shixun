"""MCP Server 冒烟（E5）：用官方 SDK 客户端连接 stdio server，验证 2 个工具可用。

用法（项目根目录）：
    backend/.venv/Scripts/python.exe scripts/mcp_smoke.py
"""
import asyncio
import json
import sys
from pathlib import Path

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

ROOT = Path(__file__).resolve().parent.parent


async def main() -> None:
    params = StdioServerParameters(
        command=sys.executable,
        args=[str(ROOT / "backend" / "mcp_server.py")],
        cwd=str(ROOT),
    )
    async with stdio_client(params) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()
            tools = await session.list_tools()
            names = [t.name for t in tools.tools]
            assert set(names) == {"get_design_tokens_tool", "get_component_library_tool"}, names
            print("tools:", names)

            r1 = await session.call_tool("get_design_tokens_tool", {})
            tokens = json.loads(r1.content[0].text)
            assert "colors" in tokens["themes"]["default"]
            print("tokens:", sorted(tokens["themes"]["default"].keys()),
                  "| colors:", len(tokens["themes"]["default"]["colors"]))

            r2 = await session.call_tool("get_component_library_tool", {})
            library = json.loads(r2.content[0].text)
            assert len(library["components"]) == 15
            print("components:", len(library["components"]), "| first:", library["components"][0]["type"])

    print("SMOKE OK")


if __name__ == "__main__":
    asyncio.run(main())
