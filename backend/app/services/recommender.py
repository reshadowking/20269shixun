"""组件智能推荐（E3-3）：分析容器上下文，推荐 3-4 个组件（component_type / reason / suggested_index / default_props）。

T9.1 #22 口径裁定：表单容器（+switch）与商品/详情容器（+tabs）为 **4 条**（追加而非替换，
信息更全；前端列表渲染不设数量硬约束）；其余语境仍为 3 条。行为由 test_assist 锁定。

确定性规则引擎（不调 LLM）：可单测、可进 CI。
- 容器（有 children 的 frame/group）：推荐"容器内部子组件"，suggested_index 指向容器 children 末尾
- 组件（navbar 等无 children 的组件）：推荐"配套组件"，target_id 指向父容器、index 指向该组件之后
返回每条推荐带 target_id，前端据此插入到正确位置。

批次 5 裁定对照表（2026-09-19，"候选覆盖 18 类"的边界——推荐的价值在语境强相关，不为凑数推荐）：
- 补 icon（导航容器分支）：图标点缀导航项，语境强相关。default 覆盖 library 的 star 为 home——
  导航场景适配；library 默认面向通用插入场景，分叉是特征不是 bug（见条目旁注释）。
- 补 navbar（新增 hero 触发分支）：容器含营销大图而缺导航 = 页面结构缺陷，语境强相关。
- 裁 sidebar：页面结构组件，往任意容器推荐破坏布局语义（正确位置非容器语境可判定）。
- 裁 hero 本体：hero 已是该分支的触发器，"推荐已有的东西"是噪声；其他分支无营销语境判定依据。
- 裁基元（text/rect/frame）：空容器"加文本"已由 title-text 覆盖；推荐流是成品组件导向
  （前端 handleRecommendAdd 固定构造 type:'component' 节点）；基元入口在组件面板「基础元素」分区。
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
    """按容器上下文返回 0-4 条推荐（找不到节点返回空列表；T9 起表单容器追加 switch）。"""
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
    # ⚠️ 分支顺序是隐式 pre-check：navbar 分支先命中并 return，hero 分支仅在"无 navbar"时
    # 可达——调整顺序会破坏防重语义（test_hero_branch_skipped_when_navbar_present 守此约束）。
    if "navbar" in types:
        # 导航容器：搜索 / 头像 / 标签 / 图标完善导航能力
        return [
            rec("input", "导航搜索框提升查找效率", {"placeholder": "搜索…"}),
            rec("avatar", "用户头像展示登录状态", {"name": "用户"}),
            rec("tag", "角标标签突出重要状态", {"text": "NEW"}),
            # 此处覆盖 library 默认 star 为 home——导航场景适配；library 默认面向通用
            # 插入场景，不修改 library（分叉是特征不是 bug）
            rec("icon", "图标点缀导航项，强化视觉引导", {"name": "home"}),
        ]
    # hero 触发分支：容器含营销大图而缺导航 = 页面结构缺陷，推 navbar 补齐。
    # 已知边界（均接受，成本 0，与现有全部分支行为一致）：
    # - 检测基于直接子组件：navbar 在更深层（如子 frame 内）时本分支触发，
    #   画面可能出现重复导航条；
    # - 不限容器层级：非页面级容器（如含 hero 图的卡片）触发时，推 navbar 可能语义不符。
    if "hero" in types:
        return [
            rec("navbar", "检测到营销大图，顶部导航完善页面结构", {"title": "品牌名"}),
        ]
    if "input" in types or "select" in types:
        # 表单容器：提交按钮 + 补充字段 + 开关确认项（T9）
        return [
            rec("button", "表单提交按钮完成主操作", {"text": "提交", "variant": "primary"}),
            rec("select", "下拉选择收集结构化数据", {"label": "选项", "options": ["选项 A", "选项 B"]}),
            rec("input", "补充录入字段完善表单", {"label": "补充信息", "placeholder": "选填"}),
            rec("switch", "开关适合订阅/协议类确认项", {"label": "接收通知"}),
        ]
    if "stat-block" in types:
        # 数据容器：图表 + 表格让数据可视化
        return [
            rec("chart", "图表直观展示数据趋势", {"chartType": "bar", "title": "数据趋势"}),
            rec("table", "表格罗列明细数据", {"columns": [{"key": "name", "title": "名称"}], "rows": []}),
            rec("stat-block", "指标块强调关键数字", {"label": "指标", "value": "0"}),
        ]
    if "image" in types and "button" in types:
        # 商品/卡片容器：补一张卡片 + 标签页分组（T9）
        return [
            rec("card", "卡片承接图文内容，结构完整", {"title": "卡片标题", "content": "卡片描述内容"}),
            rec("title-text", "区块标题统一内容分组", {"text": "商品精选", "level": 3}),
            rec("button", "次级按钮补充行动点", {"text": "查看详情"}),
            rec("tabs", "标签页分组详情/列表内容", {"items": [{"label": "详情"}, {"label": "评价"}], "active": 0}),
        ]
    # 兜底：通用内容增强
    return [
        rec("title-text", "补充小标题完善信息层次", {"text": "补充说明", "level": 4}),
        rec("button", "添加行动按钮引导用户操作", {"text": "了解更多", "variant": "primary"}),
        rec("divider", "分割线梳理内容层次", {}),
    ]
