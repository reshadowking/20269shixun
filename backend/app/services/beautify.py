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


def preset_value(key: str, label: str | None = None) -> Any | None:
    """按 label 从预置集合取值（精确匹配；无提示取第一个）——运行时单一来源。

    供 mock 编辑等规则化写入方使用：值只能来自 shared/beautify-effects.json，
    禁止在调用方写死 hex/字符串（否则扩充效果库必然漂移）。key 或 label 不存在
    返回 None，由调用方决定降级行为。
    """
    for spec in WHITELIST["keys"]:
        if spec["key"] != key:
            continue
        values = spec.get("values") or []
        if not values:
            return None
        if label is None:
            return values[0]["value"]
        for item in values:
            if item.get("label") == label:
                return item["value"]
        return None
    return None

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


@dataclass
class LockedEditResult:
    """锁定态 AI 结果落地判定（T4 批1）。

    ok=False 时 design 恒为 before 的深拷贝（画布语义：拒绝即原样）；
    dropped 记 "node_id.key"（非预置效果值被丢弃、保留原值），丢弃 ≠ 拒绝。
    """

    ok: bool
    design: dict
    changed_ids: list[str]
    dropped: list[str]
    reason: str = ""


def apply_locked_edit(before: dict, after: dict) -> LockedEditResult:
    """锁定态下的 AI 结果落地校验（服务端闸门，T4 批1）。

    允许：仅效果白名单键（EFFECT_KEYS）变化，且取值命中预置集合（或 None 表示移除）；
    拒绝：结构（children/id/type/componentType）、文案（props）、布局（x/y/hidden 及
          非白名单 style 键如 layout/gap/padding/width/height）变化；
    丢弃：效果键存在但取值非预置 → 保留原值，记入 dropped（"node_id.key"）。

    与 before 逐位置配对比对得出结论（re-parent 在先序遍历下 id 序列可能不变，
    按位置配对才能唯一确定结构），不信任任何前端/AI 声明的 changed 列表。
    拒绝时返回 before 深拷贝（画布语义：拒绝即原样）。
    """
    design = copy.deepcopy(before)
    changed_ids: list[str] = []
    dropped: list[str] = []

    def walk(b: dict, a: dict, out: dict) -> str | None:
        """按位置配对并应用合法效果；通过返回 None，否则返回可读拒绝原因。"""
        if b.get("id") != a.get("id"):
            return "结构变更（节点 id 不一致）"
        for field in ("type", "componentType", "props", "x", "y", "hidden"):
            if b.get(field) != a.get(field):
                return f"文案或布局变更（节点 {b.get('id')} 的 {field}）"
        bc = b.get("children") or []
        ac = a.get("children") or []
        if len(bc) != len(ac):
            return f"结构变更（节点 {b.get('id')} 的子节点数 {len(bc)} → {len(ac)}）"

        style_b = b.get("style") or {}
        style_a = a.get("style") or {}
        out_style = out.setdefault("style", {})
        node_id = str(b.get("id"))
        for key in set(style_b) | set(style_a):
            vb, va = style_b.get(key), style_a.get(key)
            if vb == va:
                continue
            if key not in EFFECT_KEYS:
                return f"布局字段不可改（节点 {node_id} 的 style.{key}）"
            if va is None:
                out_style.pop(key, None)
                changed_ids.append(node_id)
            elif va in EFFECT_VALUES[key]:
                out_style[key] = va
                changed_ids.append(node_id)
            else:
                # 丢弃 ≠ 拒绝：非预置值不落地，保留原值（out 是 before 深拷贝，本就未动）
                dropped.append(f"{node_id}.{key}")
        for cb, ca, co in zip(bc, ac, out.get("children") or []):
            reason = walk(cb, ca, co)
            if reason:
                return reason
        return None

    reason = walk(before, after, design)
    if reason:
        return LockedEditResult(ok=False, design=copy.deepcopy(before), changed_ids=[], dropped=[], reason=reason)
    return LockedEditResult(ok=True, design=design, changed_ids=changed_ids, dropped=dropped, reason="")
