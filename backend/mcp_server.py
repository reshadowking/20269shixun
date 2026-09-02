"""MCP Server（E5：Anima Skill 轻量版）——向外部 AI Agent（ZCode / Claude Code / Cursor）暴露设计上下文。

工具：
- get_design_tokens：完整设计令牌 JSON（colors/typography/spacing/radius/shadow/motion/opacity）
- get_component_library：15 个组件定义数组（type/name/props 定义/default_style）

运行（stdio）：
    python backend/mcp_server.py
配置示例（.mcp.json / ZCode MCP 配置）：
    {
      "mcpServers": {
        "design-skills": { "command": "python", "args": ["backend/mcp_server.py"], "cwd": "<项目根>" }
      }
    }
"""
from app.mcp_tools import get_component_library, get_design_tokens
from mcp.server.mcpserver import MCPServer

mcp = MCPServer("design-skills")


@mcp.tool()
def get_design_tokens_tool() -> dict:
    """获取完整设计令牌 JSON（colors / typography / spacing / radius + 合规允许色列表）。
    生成界面代码时必须使用这些令牌值，禁止自创颜色与字号。"""
    return get_design_tokens()


@mcp.tool()
def get_component_library_tool() -> dict:
    """获取组件库：15 个组件定义数组（type / name / props 定义 / default_style）。
    生成界面代码时只能使用这 15 种组件类型，禁止发明新组件。"""
    return get_component_library()


if __name__ == "__main__":
    mcp.run(transport="stdio")
