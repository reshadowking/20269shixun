"""T16：AI 编辑结果的落地一致性闸门。

背景：编辑分支只做 repair → Schema 校验，而 Schema 只要求根节点有 id/type。
模型返回 `{"id":"root","type":"frame","children":[]}` 这类"合法空壳树"时可通过校验，
却会把画布上原有节点全部替换掉（实测 3 个子节点 → 0，fallback 仍为 False）。

本模块只判断"既有结构是否丢失"，不做任何修复；判定口径是 **id 多重集**（不是节点数），
因此"数量不变但 id 全换"的 1:1 替换同样会被拒绝。
唯一执行点：`generate_design()` 的编辑分支在 repair 之后、Schema 校验之前调用。
"""
from collections import Counter
from typing import Any


def _collect_ids(node: Any, out: list[str]) -> None:
    """先序遍历收集节点 id（非 dict 元素跳过）。"""
    if not isinstance(node, dict):
        return
    node_id = node.get("id")
    if isinstance(node_id, str):
        out.append(node_id)
    children = node.get("children")
    if isinstance(children, list):
        for child in children:
            _collect_ids(child, out)


def structure_loss_reason(
    before: dict[str, Any], after: dict[str, Any], allowed_removed: set[str] | None = None
) -> str | None:
    """编辑结果是否丢失了 before 的结构；通过返回 None，否则返回可读原因。

    - 根 id 变化 → 拒绝（第一种失败形态：模型换了整棵树的根）
     - before 中任一 id 在 after 中缺失 → 拒绝（含"空壳树"与"删节点"两种）
     - 其余（新增节点、属性/样式变化、未知组件降级为 frame）→ 放行

    allowed_removed（T23）：模型用 **显式 remove op** 删除的 id——只有它们可以消失；
    未声明的消失仍然拒绝（"删节点必须走 ops"）。
    """
    before_root, after_root = before.get("id"), after.get("id")
    if before_root != after_root:
        return f"根节点 id 变化（{before_root} → {after_root}）"

    before_ids: list[str] = []
    after_ids: list[str] = []
    _collect_ids(before, before_ids)
    _collect_ids(after, after_ids)

    pool = Counter(after_ids)
    allowed = allowed_removed or set()
    lost: list[str] = []
    for node_id in before_ids:
        if pool[node_id] > 0:
            pool[node_id] -= 1
        elif node_id not in allowed:
            lost.append(node_id)

    if not lost:
        return None
    shown = "、".join(lost[:3])
    suffix = "…" if len(lost) > 3 else ""
    return f"丢失 {len(lost)} 个节点：{shown}{suffix}"
