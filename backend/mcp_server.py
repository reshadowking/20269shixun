"""MCP Server（E5：Anima Skill 轻量版）——向外部 AI Agent（ZCode / Claude Code / Cursor）暴露设计上下文。

工具：
- get_design_tokens：完整设计令牌 JSON（colors/typography/spacing/radius/shadow/motion/opacity）
- get_component_library：15 个组件定义数组（type/name/props 定义/default_style）
- apply_design_edit（B2-3 轻量过渡版）：自然语言指令 + 当前设计 → 增量编辑后的合法设计树；
  复用生成链路全部后处理（宽容修复/Schema/令牌合规）。P1-6 正式 patch 版二期，本工具不构成 P1-6 交付。

运行（stdio）：
    python backend/mcp_server.py
配置示例（.mcp.json / ZCode MCP 配置）：
    {
      "mcpServers": {
        "design-skills": { "command": "python", "args": ["backend/mcp_server.py"], "cwd": "<项目根>" }
      }
    }
"""
from mcp.server.mcpserver import MCPServer

from app.mcp_tools import apply_design_edit, get_component_library, get_design_tokens

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


@mcp.tool()
def apply_design_edit_tool(design: dict, instruction: str) -> dict:
    """基于当前设计树执行一次局部修改（增量编辑）：instruction 描述改动（如"把主按钮改成红色"），
    返回修正后的完整 DesignNode 树（宽容修复/Schema/令牌合规已自动执行）。
    注意：本工具是轻量过渡版；Mock/未配置 Key 时返回原树（fallback=true）。"""
    return apply_design_edit(design, instruction)


if __name__ == "__main__":
    mcp.run(transport="stdio")
