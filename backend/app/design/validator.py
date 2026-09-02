"""DesignNode Schema 校验器：全链路唯一数据形状（v2.2 §3.1 铁律）。

- 校验通过：返回 (True, None)
- 校验失败：返回 (False, 错误信息列表)
- 对恶意 JSON / 超长输入 / 类型错误友好报错，不抛未捕获异常
"""
import json
from pathlib import Path
from typing import Any

import jsonschema

_SCHEMA_PATH = Path(__file__).resolve().parent.parent.parent.parent / "shared" / "design-schema.json"

_SCHEMA_CACHE: dict[str, Any] | None = None


def load_schema() -> dict[str, Any]:
    global _SCHEMA_CACHE
    if _SCHEMA_CACHE is None:
        with open(_SCHEMA_PATH, encoding="utf-8") as f:
            _SCHEMA_CACHE = json.load(f)
    return _SCHEMA_CACHE


class SchemaError(Exception):
    """携带结构化错误信息的 Schema 校验异常。"""

    def __init__(self, errors: list[str]):
        self.errors = errors
        super().__init__("; ".join(errors))


def validate_design(data: Any, max_depth: int = 8) -> None:
    """校验 DesignNode 树；失败抛 SchemaError。

    max_depth 防止深度嵌套的恶意 JSON 拖垮递归（配合 jsonschema 自身限制）。
    """
    if not isinstance(data, dict):
        raise SchemaError(["顶层必须是 DesignNode 对象"])
    if _depth(data) > max_depth:
        raise SchemaError([f"节点树深度超过上限 {max_depth}"])
    validator = jsonschema.Draft202012Validator(load_schema())
    errors = sorted(validator.iter_errors(data), key=lambda e: list(e.path))
    if errors:
        raise SchemaError([_format_error(e) for e in errors])


def validate_design_safe(data: Any) -> tuple[bool, list[str]]:
    """不抛异常的版本，供接口层使用。"""
    try:
        validate_design(data)
        return True, []
    except SchemaError as e:
        return False, e.errors


def _depth(node: Any, current: int = 0) -> int:
    if not isinstance(node, dict) or current > 8:
        return current
    children = node.get("children")
    if not isinstance(children, list):
        return current
    return max((_depth(c, current + 1) for c in children), default=current)


def _format_error(e: jsonschema.ValidationError) -> str:
    path = ".".join(str(p) for p in e.path) or "<root>"
    return f"{path}: {e.message}"
