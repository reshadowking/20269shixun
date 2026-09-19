"""MCP Server 冒烟（E5 + B2-3）：用官方 SDK 客户端连接 stdio server，验证 3 个工具可用。

用法（项目根目录，**默认强制 mock**，不会烧 Key）：
    backend/.venv/Scripts/python.exe scripts/mcp_smoke.py
确实要用真模型跑（会花钱）：
    backend/.venv/Scripts/python.exe scripts/mcp_smoke.py --allow-real

⚠️ 2026-09-18 教训：本脚本以前**不设护栏**，而 MCP 写工具 `apply_design_edit_tool` 内部是
`generate_design()` → `LLMClient()` 读 `backend/.env`（该项目是 real + 真 Key），与"脚本跑在
哪台 shell、有没有设 LLM_MODE"完全无关 —— 于是"随手跑一下冒烟"实际打了 3 次真实调用
（账本可查：stage=fill、tok_in 7422）。现在像 run_golden.py / measure_ops_improvement.py 一样：
默认把子进程环境切成 mock，要真跑必须显式 --allow-real。
"""
import asyncio
import json
import os
import sys
import tempfile
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
    allow_real = "--allow-real" in sys.argv
    env = dict(os.environ)
    if not allow_real:
        # 写一份临时 mock 配置并让子进程读它：不碰 backend/.env、不碰用户的 Key
        mock = Path(tempfile.gettempdir()) / "mcp-smoke-llm.json"
        mock.write_text('{"llm_mode":"mock","llm_api_key":""}', encoding="utf-8")
        env["LLM_CONFIG_FILE"] = str(mock)
        env["LLM_MODE"] = "mock"
        print("[模式] mock（只验工具形态，不调用模型；要真跑加 --allow-real）")
    else:
        print("[模式] REAL —— 会调用真实模型并计费（--allow-real 显式授权）")

    params = StdioServerParameters(
        command=sys.executable,
        args=[str(ROOT / "backend" / "mcp_server.py")],
        cwd=str(ROOT),
        env=env,
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
