"""MCP 工具实现（E5-1/E5-2）：设计令牌 + 组件库，供 MCP Server 与 pytest 直接调用。

数据源（单一来源）：
- shared/design-system.yaml → get_design_tokens
- shared/component-library.json → get_component_library
"""
import json
from functools import lru_cache
from pathlib import Path

import yaml

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
    """读取 component-library.json，返回 15 个组件定义数组。"""
    with open(LIBRARY_JSON, encoding="utf-8") as f:
        return json.load(f)


def get_design_tokens() -> dict:
    """MCP 工具：输出完整设计令牌 JSON（colors/typography/spacing/radius + 允许色列表）。"""
    return load_design_tokens()


def get_component_library() -> dict:
    """MCP 工具：输出 15 个组件定义数组（type/name/props 定义/default_style）。"""
    return load_component_library()
