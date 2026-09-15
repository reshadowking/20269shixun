"""T23：编辑用的结构化增量（ops）——模型只输出操作列表，服务端精确落地。

动机：整树重写一次要发 7745 token、收 9309 token（54k 字符、20–25s），且模型"顺手重写"
会带来结构漂移。改输出 ops 后，服务端只动该动的节点，改动可枚举、可审计。

整批原子：任一 op 非法（未知 op / 缺字段 / 节点不存在 / 未声明字段 / 越界 / 超过 MAX_OPS）
→ 整批拒绝并返回原树与可读原因（与 `beautify.apply_effects` 的原子语义一致）。
"""
import copy
from typing import Any

# op 名 → 必填字段（提示词里的 op 白名单由这里生成，禁止手抄）
OP_TYPES = {
    "set_text": ("id", "value"),
    "set_prop": ("id", "key", "value"),
    "set_style": ("id", "key", "value"),
    "insert": ("parent", "index", "node"),
    "remove": ("id",),
    "move": ("id", "parent", "index"),
}
MAX_OPS = 20


def _find(node: dict, node_id: str) -> tuple[dict, list | None, int] | None:
    """返回 (节点, 其所在 children 列表, 下标)；根节点返回 (root, None, -1)。"""
    if node.get("id") == node_id:
        return node, None, -1
    children = node.get("children")
    if isinstance(children, list):
        for index, child in enumerate(children):
            if isinstance(child, dict):
                if child.get("id") == node_id:
                    return child, children, index
                hit = _find(child, node_id)
                if hit:
                    return hit
    return None


def _declared_props(component_type: Any) -> frozenset[str]:
    from .generate import component_prop_names  # 局部导入避免模块级循环

    return component_prop_names(component_type) if isinstance(component_type, str) else frozenset()


def apply_ops(tree: dict[str, Any], ops: Any) -> tuple[dict[str, Any], list[str], set[str], str]:
    """返回 (新树 | 原树, 受影响节点 id, 被显式删除的 id, 拒绝原因)。原因非空时新树无效。"""
    if not isinstance(ops, list) or not ops:
        return tree, [], set(), "ops 必须是非空数组（无改动请返回空数组并把 user_request 说清楚）"
    if len(ops) > MAX_OPS:
        return tree, [], set(), f"ops 数量超限（{len(ops)} > {MAX_OPS}）"

    work = copy.deepcopy(tree)
    affected: list[str] = []
    removed: set[str] = set()
    for op in ops:
        if not isinstance(op, dict) or op.get("op") not in OP_TYPES:
            return tree, [], set(), f"未知操作：{op.get('op') if isinstance(op, dict) else op!r}"
        kind = op["op"]
        missing = [field for field in OP_TYPES[kind] if field not in op]
        if missing:
            return tree, [], set(), f"{kind} 缺少字段：{'、'.join(missing)}"

        if kind == "insert":
            parent = _find(work, str(op["parent"]))
            if parent is None:
                return tree, [], set(), f"父节点不存在：{op['parent']}"
            children = parent[0].setdefault("children", [])
            if not isinstance(children, list):
                return tree, [], set(), f"父节点不是容器：{op['parent']}"
            index = op["index"]
            if not isinstance(index, int) or index < 0 or index > len(children):
                return tree, [], set(), f"插入位置越界：{index}"
            node = op["node"]
            if not isinstance(node, dict):
                return tree, [], set(), "insert.node 必须是对象"
            node = copy.deepcopy(node)
            if not node.get("id"):
                node["id"] = f"{op['parent']}-c{len(children)}"  # 与 repair_design 的派生规则一致
            children.insert(index, node)
            affected.append(str(node["id"]))
            continue

        found = _find(work, str(op["id"]))
        if found is None:
            return tree, [], set(), f"节点不存在：{op['id']}"
        node, siblings, index = found
        if kind == "set_text":
            node.setdefault("props", {})["text"] = str(op["value"])
        elif kind == "set_prop":
            declared = _declared_props(node.get("componentType"))
            if declared and op["key"] not in declared:
                return tree, [], set(), f"{node.get('componentType')} 没有字段 {op['key']}"
            node.setdefault("props", {})[op["key"]] = op["value"]
        elif kind == "set_style":
            node.setdefault("style", {})[op["key"]] = op["value"]
        elif kind == "remove":
            if siblings is None:
                return tree, [], set(), "根节点不可删除"
            siblings.pop(index)
            removed.add(str(op["id"]))
            affected.append(str(op["id"]))
            continue
        elif kind == "move":
            if siblings is None:
                return tree, [], set(), "根节点不可移动"
            target = _find(work, str(op["parent"]))
            if target is None:
                return tree, [], set(), f"目标父节点不存在：{op['parent']}"
            target_children = target[0].setdefault("children", [])
            if not isinstance(target_children, list):
                return tree, [], set(), f"目标不是容器：{op['parent']}"
            moving = siblings.pop(index)
            target_children.insert(min(max(0, int(op["index"])), len(target_children)), moving)
        affected.append(str(node.get("id")))
    return work, affected, removed, ""
