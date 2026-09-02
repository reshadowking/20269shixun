"""智能布局优化（E3-2）：AI 辅助统一间距 / 对齐 / 大小一致性 / 合理留白。

硬约束（验收标准）：只改布局属性（padding/gap/align/width/height/flex），
不改内容（text/value/data）、不改颜色、不改组件类型。

确定性规则引擎（不调 LLM）：可单测、可进 CI；返回 (设计, 优化报告)。
规则：
1. 同容器内同类型兄弟节点：padding / align / width / height 取众数统一（大小与间距一致性）
2. 单节点 padding 向最近标准间距（4/8/12/16/20/24/32/40/48）取整（合理留白）
"""
import copy
from collections import Counter
from typing import Any

# 标准间距台阶（design-system.yaml spacing + 常用扩展）
SPACING_STEPS = [4, 8, 12, 16, 20, 24, 32, 40, 48]

# 允许修改的布局属性白名单（其余字段一律不动）
LAYOUT_KEYS = {"gap", "padding", "margin", "align", "justify", "alignItems", "width", "height", "flex"}


def _majority(values: list[Any]) -> Any | None:
    """众数（平局取先出现者）；空列表返回 None。"""
    present = [v for v in values if v is not None]
    if not present:
        return None
    return Counter(present).most_common(1)[0][0]


def _nearest_spacing(value: int) -> int:
    return min(SPACING_STEPS, key=lambda s: abs(s - value))


def _unify_group(group: list[dict], key: str, report: dict, kind: str) -> None:
    """组内同类型兄弟节点的某布局属性统一为众数（值缺失的成员也一并写入，保证一致）。"""
    values = [c.get("style", {}).get(key) for c in group]
    if len([v for v in values if v is not None]) == 0:
        return
    if len(set(values)) == 1 and all(v is not None for v in values):
        return  # 已一致
    target = _majority(values)
    if target is None:
        return
    for child in group:
        style = child.setdefault("style", {})
        if style.get(key) != target:
            style[key] = target
            report[kind] += 1


def _normalize_padding(node: dict, report: dict) -> None:
    """单节点 padding 标准化到最近标准间距（≥8 才处理，避免 4/0 这类极小值被误改）。"""
    pad = node.get("style", {}).get("padding")
    if isinstance(pad, (int, float)) and pad >= 8 and pad not in SPACING_STEPS:
        node["style"]["padding"] = _nearest_spacing(pad)
        report["spacing"] += 1


def optimize_layout(design: dict[str, Any]) -> tuple[dict[str, Any], dict[str, int]]:
    """返回 (优化后的设计, 报告 {spacing, align, size, total})。输入不被修改。"""
    result = copy.deepcopy(design)
    report = {"spacing": 0, "align": 0, "size": 0}

    def walk(node: dict) -> None:
        _normalize_padding(node, report)
        children = node.get("children") or []
        if children:
            # 同类型兄弟分组（componentType 优先，frame/text 按 type）
            groups: dict[str, list[dict]] = {}
            for child in children:
                key = child.get("componentType") or child.get("type") or "unknown"
                groups.setdefault(key, []).append(child)
            for group in groups.values():
                if len(group) < 2:
                    continue
                _unify_group(group, "padding", report, "spacing")
                _unify_group(group, "align", report, "align")
                _unify_group(group, "width", report, "size")
                _unify_group(group, "height", report, "size")
        for child in children:
            _normalize_padding(child, report)
            walk(child)

    walk(result)
    report["total"] = report["spacing"] + report["align"] + report["size"]
    return result, report
