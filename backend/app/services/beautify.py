"""缺陷 3：美化阶段效果写入层（白名单唯一执行点）。

规则（与 shared/beautify-effects.json 单一来源）：
- 只允许白名单 key：backgroundImage / shadow / animation / radius / border / transform；
- 每个 key 的取值必须命中预置值（精确匹配），不接受自由 CSS —— 白名单即注入防线；
- value 为 null 表示移除该效果；
- 布局（layout/gap/padding/width/height/x/y）、结构（children/type/id）、文本（props）一律拒绝。
"""
import copy
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent.parent.parent
WHITELIST_FILE = ROOT / "shared" / "beautify-effects.json"

with WHITELIST_FILE.open(encoding="utf-8") as f:
    WHITELIST: dict[str, Any] = json.load(f)

# key -> {允许值集合}；changesSize 标记用于前端"可能改变尺寸"二次确认
EFFECT_KEYS: list[str] = [k["key"] for k in WHITELIST["keys"]]
EFFECT_VALUES: dict[str, set] = {
    k["key"]: {_v["value"] for _v in k["values"]} for k in WHITELIST["keys"]
}
EFFECT_CHANGES_SIZE: dict[str, bool] = {k["key"]: bool(k["changesSize"]) for k in WHITELIST["keys"]}

# 明确拒绝的非样式字段（构造请求时最常被夹带的字段，给前端可读的报错）
FORBIDDEN_FIELDS = {
    "layout", "gap", "padding", "spacing", "width", "height", "x", "y",
    "children", "type", "id", "componentType", "props", "hidden", "text",
}


class EffectError(ValueError):
    """效果写入被拒（路由层转 422，附可读原因）。"""

    def __init__(self, message: str, *, rejected_keys: list[str] | None = None):
        super().__init__(message)
        self.rejected_keys = rejected_keys or []


def find_node(tree: dict, node_id: str) -> dict | None:
    if tree.get("id") == node_id:
        return tree
    for child in tree.get("children") or []:
        hit = find_node(child, node_id)
        if hit is not None:
            return hit
    return None


def validate_effects(effects: Any) -> dict[str, Any]:
    """校验效果选项；返回规范化后的 {key: value}（value=None 表示移除）。"""
    if not isinstance(effects, dict) or not effects:
        raise EffectError("effects 不能为空")
    rejected: list[str] = []
    for key, value in effects.items():
        if key in FORBIDDEN_FIELDS or key not in EFFECT_KEYS:
            rejected.append(key)
            continue
        if value is None:
            continue
        if value not in EFFECT_VALUES[key]:
            raise EffectError(
                f"效果「{key}」的取值不在白名单内：{value!r}（只接受预置值）",
                rejected_keys=[key],
            )
    if rejected:
        raise EffectError(
            f"美化阶段只允许样式白名单字段，以下字段被拒绝：{', '.join(sorted(rejected))}",
            rejected_keys=sorted(rejected),
        )
    return dict(effects)


def changes_size(effects: dict[str, Any]) -> bool:
    """是否包含可能改变组件尺寸的效果（前端据此二次确认）。"""
    return any(EFFECT_CHANGES_SIZE.get(k, False) for k, v in effects.items() if v is not None)


@dataclass
class ApplyResult:
    design: dict
    applied: list[str]
    removed: list[str]
    changes_size: bool


def apply_effects(tree: dict, node_id: str, effects: Any) -> ApplyResult:
    """把白名单效果写入目标节点（深拷贝，不改原树）。"""
    normalized = validate_effects(effects)
    node = find_node(tree, node_id)
    if node is None:
        raise EffectError(f"节点不存在：{node_id}")

    new_tree = copy.deepcopy(tree)
    target = find_node(new_tree, node_id)
    assert target is not None  # find_node 已在原树校验
    style = target.setdefault("style", {})

    applied: list[str] = []
    removed: list[str] = []
    for key, value in normalized.items():
        if value is None:
            style.pop(key, None)
            removed.append(key)
        else:
            style[key] = value
            applied.append(key)

    return ApplyResult(
        design=new_tree,
        applied=applied,
        removed=removed,
        changes_size=changes_size(normalized),
    )
