"""组件智能推荐（E3-3）：分析容器上下文，推荐 3 个组件（component_type / reason / suggested_index / default_props）。

确定性规则引擎（不调 LLM）：可单测、可进 CI。
- 容器（有 children 的 frame/group）：推荐"容器内部子组件"，suggested_index 指向容器 children 末尾
- 组件（navbar 等无 children 的组件）：推荐"配套组件"，target_id 指向父容器、index 指向该组件之后
返回每条推荐带 target_id，前端据此插入到正确位置。
"""
from typing import Any


def _find_node(node: dict, node_id: str) -> dict | None:
    if node.get("id") == node_id:
        return node
    for child in node.get("children") or []:
        hit = _find_node(child, node_id)
        if hit:
            return hit
    return None


def _parent_of(node: dict, node_id: str) -> tuple[dict | None, list[dict] | None]:
    """返回 (父节点, 父的 children 列表)；未找到返回 (None, None)。"""
    children = node.get("children") or []
    for child in children:
        if child.get("id") == node_id:
            return node, children
        found = _parent_of(child, node_id)
        if found[0] is not None:
            return found
    return None, None


def _rec(component_type: str, reason: str, index: int, props: dict | None = None) -> dict:
    return {
        "component_type": component_type,
        "reason": reason,
        "suggested_index": index,
        "default_props": props or {},
    }


def recommend_components(design: dict[str, Any], container_id: str) -> list[dict]:
    """按容器上下文返回 0-3 条推荐（找不到节点返回空列表）。"""
    node = _find_node(design, container_id)
    if node is None:
        return []

    # 容器 = frame/group（children 键缺失也是空容器）；组件走配套推荐；text/rect 不可添加
    is_container = node.get("type") in ("frame", "group")
    if not is_container and node.get("type") != "component":
        return []
    if not is_container:
        # 组件（navbar/sidebar/hero 等）：推荐配套组件，插入到父容器中该组件之后
        parent, siblings = _parent_of(design, container_id)
        if parent is None or siblings is None:
            return []
        my_index = next((i for i, c in enumerate(siblings) if c.get("id") == container_id), -1)
        at = my_index + 1
        return [
            {
                "target_id": parent["id"],
                **_rec("title-text", "Logo 文字让品牌更醒目（导航配套）", at, {"text": "品牌名", "level": 3}),
            },
            {
                "target_id": parent["id"],
                **_rec("input", "搜索框方便用户快速查找", at + 1, {"placeholder": "搜索…", "style_hint": {"width": 200}}),
            },
            {
                "target_id": parent["id"],
                **_rec("avatar", "用户头像完善导航信息", at + 2, {"name": "用户"}),
            },
        ]

    children = node.get("children") or []
    types = [c.get("componentType") for c in children if c.get("type") == "component"]
    at = len(children)
    target = container_id

    def rec(component_type: str, reason: str, props: dict | None = None) -> dict:
        return {"target_id": target, **_rec(component_type, reason, at, props)}

    if not children:
        # 空容器：标题 + 图片 + 按钮（验收：文本 + 按钮 + 图片）
        return [
            rec("title-text", "空容器先放标题，明确区块用途", {"text": "区块标题", "level": 3}),
            rec("image", "配图让区块更直观", {"alt": "配图"}),
            rec("button", "添加行动按钮引导操作", {"text": "立即开始", "variant": "primary"}),
        ]
    if "navbar" in types:
        # 导航容器：搜索 / 头像 / 标签完善导航能力
        return [
            rec("input", "导航搜索框提升查找效率", {"placeholder": "搜索…"}),
            rec("avatar", "用户头像展示登录状态", {"name": "用户"}),
            rec("tag", "角标标签突出重要状态", {"text": "NEW"}),
        ]
    if "input" in types or "select" in types:
        # 表单容器：提交按钮 + 补充字段
        return [
            rec("button", "表单提交按钮完成主操作", {"text": "提交", "variant": "primary"}),
            rec("select", "下拉选择收集结构化数据", {"label": "选项", "options": ["选项 A", "选项 B"]}),
            rec("input", "补充录入字段完善表单", {"label": "补充信息", "placeholder": "选填"}),
        ]
    if "stat-block" in types:
        # 数据容器：图表 + 表格让数据可视化
        return [
            rec("chart", "图表直观展示数据趋势", {"chartType": "bar", "title": "数据趋势"}),
            rec("table", "表格罗列明细数据", {"columns": [{"key": "name", "title": "名称"}], "rows": []}),
            rec("stat-block", "指标块强调关键数字", {"label": "指标", "value": "0"}),
        ]
    if "image" in types and "button" in types:
        # 商品/卡片容器：补一张卡片
        return [
            rec("card", "卡片承接图文内容，结构完整", {"title": "卡片标题", "content": "卡片描述内容"}),
            rec("title-text", "区块标题统一内容分组", {"text": "商品精选", "level": 3}),
            rec("button", "次级按钮补充行动点", {"text": "查看详情"}),
        ]
    # 兜底：通用内容增强
    return [
        rec("title-text", "补充小标题完善信息层次", {"text": "补充说明", "level": 4}),
        rec("button", "添加行动按钮引导用户操作", {"text": "了解更多", "variant": "primary"}),
        rec("divider", "分割线梳理内容层次", {}),
    ]
