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
# 2026-09-18：位置字段。渲染器读的是**节点级** x/y（自由画布用），不是 style.x/style.left；
# 模型表达"往右挪一点"时最自然的写法就是 set_style key=x / key=left，此前会写进 style 里
# ——渲染器根本不看，于是"改了但画布没动"，还照样记一次 changed（假动作 + 假撤销步）。
POSITION_KEYS = {"x": "x", "left": "x", "y": "y", "top": "y"}
# T28：单条 insert 的子树规模上限——防止"用一条 insert 插入整页"变相整树重写（长而脆的 JSON）
MAX_INSERT_NODES = 20
MAX_INSERT_DEPTH = 4


def _subtree_size(node: Any, depth: int = 1) -> tuple[int, int]:
    """返回 (节点数, 最大深度)；用于 insert 护栏。"""
    if not isinstance(node, dict):
        return 0, depth
    count, deepest = 1, depth
    for child in node.get("children") or []:
        child_count, child_depth = _subtree_size(child, depth + 1)
        count += child_count
        deepest = max(deepest, child_depth)
    return count, deepest


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


def _collect_ids(node: Any, out: list[str]) -> None:
    """收集子树里所有 id（含自身）；非 dict 元素跳过。"""
    if not isinstance(node, dict):
        return
    node_id = node.get("id")
    if isinstance(node_id, str):
        out.append(node_id)
    children = node.get("children")
    if isinstance(children, list):
        for child in children:
            _collect_ids(child, out)


def _declared_props(component_type: Any) -> frozenset[str]:
    from .generate import component_prop_names  # 局部导入避免模块级循环

    return component_prop_names(component_type) if isinstance(component_type, str) else frozenset()


def apply_ops(tree: dict[str, Any], ops: Any) -> tuple[dict[str, Any], list[str], set[str], str]:
    """返回 (新树 | 原树, 受影响节点 id, 被显式删除的 id, 拒绝原因)。原因非空时新树无效。"""
    if not isinstance(ops, list):
        return tree, [], set(), f"ops 必须是数组：{ops!r}"
    if not ops:
        # 空数组 = 模型判定"无需改动"（提示词明确要求无改动时返回 {"ops":[]}）。
        # 这是合法结果，不是失败：原树原样返回、原因留空，由调用方按"零改动"呈现。
        return tree, [], set(), ""
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
            size, depth = _subtree_size(node)
            if size > MAX_INSERT_NODES or depth > MAX_INSERT_DEPTH:
                return (
                    tree,
                    [],
                    set(),
                    (
                        f"单条 insert 的子树过大（{size} 个节点 / 深度 {depth}）——请拆成多条 insert，"
                        "或改用 set_* 只改必要节点（不要用一条 op 插入整页）"
                    ),
                )
            node = copy.deepcopy(node)
            if not node.get("id"):
                node["id"] = f"{op['parent']}-c{len(children)}"  # 与 repair_design 的派生规则一致
            # 重复 id 会破坏整棵树的节点定位（前端查找/选中、Yjs 同步、导出 React key 都按 id 走），
            # 而 structure_loss_reason 用的是计数比较、抓不到"多出来一个同 id 节点"，所以在这里挡。
            incoming: list[str] = []
            _collect_ids(node, incoming)
            duplicated = [i for i in incoming if _find(work, i) is not None]
            if len(incoming) != len(set(incoming)) or duplicated:
                bad = duplicated[0] if duplicated else incoming[0]
                return tree, [], set(), f"插入的节点 id 已存在：{bad}（id 必须唯一）"
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
            key = op["key"]
            value = op["value"]
            # 位置类 key 落到**节点级** x/y（渲染器只认这两个）；值不是数字就退回流样式（不崩、不静默）
            field = POSITION_KEYS.get(key) if isinstance(key, str) else None
            if field and isinstance(value, (int, float)) and not isinstance(value, bool):
                node[field] = value
            else:
                node.setdefault("style", {})[key] = value
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
            # index 必须是整数：模型偶尔输出 null / "0" 这类，int() 会抛 TypeError/ValueError
            # 一路穿到接口层变成 502「AI 生成失败：int() argument must be...」（实测）。
            if not isinstance(op["index"], int) or isinstance(op["index"], bool):
                return tree, [], set(), f"move 的 index 必须是整数：{op['index']!r}"
            # 防环（2026-09-17 实测复现）：移到自己或自己的后代里时，子树会先被 pop 掉、
            # 再插进"已脱离主树"的那份旧引用里 → 节点与它的整棵子树**凭空消失**（静默丢数据）。
            # 前端 `designStore.moveNodeTo` 一直有这条守卫，服务端 ops 引擎漏了；这里补齐。
            if _find(node, str(op["parent"])) is not None:
                return tree, [], set(), f"不能把节点移到它自己或它的子节点下面：{op['parent']}"
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
