"""模板库（v2.2 §4.3：8 个模板，每个 = DesignNode 骨架 + 默认文案）。

模板是"可渲染的默认稿"：mock 模式直接返回模板；real 模式下 LLM 基于骨架填充参数与文案。
组件引用必须来自组件注册表（15 个 componentType）。
"""

from typing import Any


def _text(id: str, text: str, **style: Any) -> dict[str, Any]:
    node: dict[str, Any] = {"id": id, "type": "text", "props": {"text": text}}
    if style:
        node["style"] = style
    return node


def _title(id: str, text: str, level: int = 2, **style: Any) -> dict[str, Any]:
    node: dict[str, Any] = {"id": id, "type": "component", "componentType": "title-text", "props": {"text": text, "level": level}}
    if style:
        node["style"] = style
    return node


def _frame(id: str, children: list[dict[str, Any]], **style: Any) -> dict[str, Any]:
    return {"id": id, "type": "frame", "style": style or {"layout": "column"}, "children": children}


def _product_card(id: str, name: str, price: str, original: str, discount: str) -> dict[str, Any]:
    """商品卡片骨架（问题 7：图/名/原价划线/现价/折扣标签/加购按钮，AI 填充时按此结构生成）。"""
    return _frame(
        f"{id}",
        [
            {"id": f"{id}-img", "type": "component", "componentType": "image", "props": {"alt": name}, "style": {"width": 180, "height": 140}},
            {"id": f"{id}-name", "type": "text", "props": {"text": name}, "style": {"fontSize": 14, "fontWeight": 600}},
            {"id": f"{id}-price", "type": "frame", "style": {"layout": "row", "gap": 8, "alignItems": "flex-end"},
             "children": [
                 {"id": f"{id}-now", "type": "text", "props": {"text": price}, "style": {"color": "danger", "fontSize": 18, "fontWeight": 700}},
                 {"id": f"{id}-old", "type": "text", "props": {"text": original}, "style": {"color": "text-light", "fontSize": 12, "textDecoration": "line-through"}},
             ]},
            {"id": f"{id}-tag", "type": "component", "componentType": "tag", "props": {"text": discount, "color": "danger"}},
            {"id": f"{id}-btn", "type": "component", "componentType": "button", "props": {"text": "加入购物车", "variant": "primary"}, "style": {"width": 180, "height": 36}},
        ],
        # background 用白名单内的 #FFFFFF（"card" 不是令牌名，会被合规检查器拉回）
        layout="column", gap=8, background="#FFFFFF", padding=12, radius=12, width=200,
    )


TEMPLATES: dict[str, dict[str, Any]] = {
    "login": _frame(
        "login-root",
        [
            {"id": "login-logo", "type": "component", "componentType": "avatar", "props": {"name": "P"}, "style": {"width": 44, "height": 44, "radius": 12, "background": "primary", "color": "#FFFFFF", "fontSize": 18}},
            _title("login-title", "欢迎回来", 3),
            {"id": "login-field-user", "type": "component", "componentType": "input", "props": {"label": "账号", "placeholder": "请输入邮箱或手机号"}, "style": {"width": 320}},
            {"id": "login-field-pass", "type": "component", "componentType": "input", "props": {"label": "密码", "placeholder": "请输入密码", "type_": "password"}, "style": {"width": 320}},
            {"id": "login-btn", "type": "component", "componentType": "button", "props": {"text": "登 录", "variant": "primary"}, "style": {"width": 320, "height": 44}},
            {"id": "login-links", "type": "text", "props": {"text": "忘记密码 · 注册账号"}, "style": {"align": "center", "color": "text-light", "fontSize": 12}},
        ],
        layout="column", gap=16, background="background", padding=40, width=380, radius=12,
    ),
    "landing": _frame(
        "landing-root",
        [
            {"id": "landing-nav", "type": "component", "componentType": "navbar", "props": {"title": "产品名", "links": [{"label": "功能", "href": "#"}, {"label": "定价", "href": "#"}, {"label": "关于", "href": "#"}]}},
            {"id": "landing-hero", "type": "component", "componentType": "hero", "props": {"title": "让设计更快一步", "subtitle": "自然语言生成高保真界面，所见即所得", "cta": {"text": "立即开始"}}},
            _frame("landing-features",
                [
                    {"id": "landing-feat-1", "type": "component", "componentType": "card", "props": {"title": "AI 生成", "content": "一句话生成完整页面"}},
                    {"id": "landing-feat-2", "type": "component", "componentType": "card", "props": {"title": "规范约束", "content": "设计令牌全程护航"}},
                    {"id": "landing-feat-3", "type": "component", "componentType": "card", "props": {"title": "一键转码", "content": "设计稿直接导出 React"}},
                ],
                layout="row", gap=16, padding=24,
            ),
        ],
        layout="column", gap=0, background="background", width=720,
    ),
    "ecommerce": _frame(
        "ecommerce-root",
        [
            {"id": "ecom-nav", "type": "component", "componentType": "navbar", "props": {"title": "优选商城", "links": [{"label": "首页", "href": "#"}, {"label": "分类", "href": "#"}, {"label": "购物车", "href": "#"}]}},
            _title("ecom-title", "618 狂欢 · 限时领券", 2, align="center", color="text-primary"),
            {"id": "ecom-sub", "type": "text", "props": {"text": "满减优惠券，先到先得，每人限领 3 张"}, "style": {"align": "center", "color": "text-secondary", "fontSize": 13}},
            _frame("ecom-coupons",
                [
                    {"id": "ecom-c1", "type": "component", "componentType": "button", "props": {"text": "¥50 满199可用", "variant": "primary"}, "style": {"width": 220, "height": 96, "radius": 12, "background": "#FFFFFF", "color": "danger", "fontSize": 16}},
                    {"id": "ecom-c2", "type": "component", "componentType": "button", "props": {"text": "¥100 满399可用"}, "style": {"width": 220, "height": 96, "radius": 12, "background": "#FFFFFF", "color": "danger", "fontSize": 16}},
                    {"id": "ecom-c3", "type": "component", "componentType": "button", "props": {"text": "¥200 满799可用"}, "style": {"width": 220, "height": 96, "radius": 12, "background": "#FFFFFF", "color": "danger", "fontSize": 16}},
                ],
                layout="row", gap=24, justify="center",
            ),
            _frame("ecom-products",
                [
                    _product_card("ecom-p1", "Air Run Pro 跑步鞋", "¥299", "¥599", "限时 5 折"),
                    _product_card("ecom-p2", "Flex Trainer 训练鞋", "¥259", "¥459", "立减 200"),
                    _product_card("ecom-p3", "Court Classic 板鞋", "¥329", "¥529", "限时 6 折"),
                    _product_card("ecom-p4", "Trail Blaze 越野鞋", "¥399", "¥699", "新品 8 折"),
                ],
                layout="row", gap=16, justify="center",
            ),
            {"id": "ecom-note", "type": "text", "props": {"text": "活动时间：9月1日 - 9月15日 · 领取后 7 天内有效"}, "style": {"align": "center", "color": "text-light", "fontSize": 12}},
        ],
        layout="column", gap=16, background="#FFF0F0", padding=32, width=920,
    ),
    "dashboard": _frame(
        "dashboard-root",
        [
            {"id": "dash-nav", "type": "component", "componentType": "navbar", "props": {"title": "经营分析平台", "links": [{"label": "总览", "href": "#"}, {"label": "报表", "href": "#"}]}},
            _frame("dash-stats",
                [
                    {"id": "dash-s1", "type": "component", "componentType": "stat-block", "props": {"label": "本月营收", "value": "¥1,284,500", "trend": "↑ 12.6%"}},
                    {"id": "dash-s2", "type": "component", "componentType": "stat-block", "props": {"label": "新增用户", "value": "8,642", "trend": "↑ 8.3%"}},
                    {"id": "dash-s3", "type": "component", "componentType": "stat-block", "props": {"label": "客单价", "value": "¥148.6", "trend": "↓ 2.4%"}},
                ],
                layout="row", gap=16,
            ),
            {"id": "dash-chart", "type": "component", "componentType": "chart",
             "props": {"chartType": "bar", "title": "近 7 日营收趋势",
                       "data": [{"day": "周一", "value": 45}, {"day": "周二", "value": 68}, {"day": "周三", "value": 52}, {"day": "周四", "value": 82}, {"day": "周五", "value": 60}, {"day": "周六", "value": 92}, {"day": "周日", "value": 74}],
                       "xKey": "day", "yKey": "value"},
             "style": {"width": 680, "height": 220}},
            {"id": "dash-table", "type": "component", "componentType": "table",
             "props": {"columns": [{"key": "name", "title": "渠道"}, {"key": "amount", "title": "成交额"}, {"key": "trend", "title": "环比"}],
                       "rows": [{"name": "直营门店", "amount": "¥420,000", "trend": "+6.2%"}, {"name": "线上商城", "amount": "¥368,500", "trend": "+15.8%"}, {"name": "分销渠道", "amount": "¥210,000", "trend": "-3.1%"}]},
             "style": {"width": 680}},
        ],
        layout="column", gap=16, background="background", padding=24, width=720,
    ),
    "form": _frame(
        "form-root",
        [
            _title("form-title", "用户信息登记", 3),
            {"id": "form-name", "type": "component", "componentType": "input", "props": {"label": "姓名", "placeholder": "请输入姓名"}, "style": {"width": 320}},
            {"id": "form-email", "type": "component", "componentType": "input", "props": {"label": "邮箱", "placeholder": "name@example.com", "type_": "email"}, "style": {"width": 320}},
            {"id": "form-city", "type": "component", "componentType": "select", "props": {"label": "城市", "placeholder": "请选择城市", "options": ["北京", "上海", "广州", "深圳"]}, "style": {"width": 320}},
            {"id": "form-note", "type": "component", "componentType": "input", "props": {"label": "备注", "placeholder": "选填"}, "style": {"width": 320}},
            {"id": "form-btn", "type": "component", "componentType": "button", "props": {"text": "提交登记", "variant": "primary"}, "style": {"width": 320, "height": 44}},
        ],
        layout="column", gap=16, background="background", padding=32, width=380, radius=12,
    ),
    "list": _frame(
        "list-root",
        [
            {"id": "list-nav", "type": "component", "componentType": "navbar", "props": {"title": "订单管理", "links": [{"label": "全部订单", "href": "#"}, {"label": "待发货", "href": "#"}]}},
            {"id": "list-search", "type": "component", "componentType": "input", "props": {"placeholder": "搜索订单号 / 客户名"}, "style": {"width": 320}},
            {"id": "list-table", "type": "component", "componentType": "table",
             "props": {"columns": [{"key": "order", "title": "订单号"}, {"key": "customer", "title": "客户"}, {"key": "amount", "title": "金额"}, {"key": "status", "title": "状态"}],
                       "rows": [{"order": "A1001", "customer": "张伟", "amount": "¥299", "status": "已发货"}, {"order": "A1002", "customer": "李娜", "amount": "¥159", "status": "待发货"}, {"order": "A1003", "customer": "王强", "amount": "¥899", "status": "已签收"}]},
             "style": {"width": 680}},
            _frame("list-pager",
                [
                    {"id": "list-page-1", "type": "component", "componentType": "tag", "props": {"text": "1", "color": "primary"}},
                    {"id": "list-page-2", "type": "component", "componentType": "tag", "props": {"text": "2"}},
                    {"id": "list-page-3", "type": "component", "componentType": "tag", "props": {"text": "3"}},
                ],
                layout="row", gap=8,
            ),
        ],
        layout="column", gap=16, background="background", padding=24, width=720,
    ),
    "profile": _frame(
        "profile-root",
        [
            _frame("profile-head",
                [
                    {"id": "profile-avatar", "type": "component", "componentType": "avatar", "props": {"name": "设计师"}, "style": {"width": 64, "height": 64, "fontSize": 24}},
                    {"id": "profile-name", "type": "component", "componentType": "title-text", "props": {"text": "设计师小王", "level": 3}},
                    {"id": "profile-tags", "type": "frame", "style": {"layout": "row", "gap": 8},
                     "children": [
                         {"id": "profile-tag-1", "type": "component", "componentType": "tag", "props": {"text": "高级设计师", "color": "primary"}},
                         {"id": "profile-tag-2", "type": "component", "componentType": "tag", "props": {"text": "团队负责人"}},
                     ]},
                ],
                layout="column", gap=12, align="center",
            ),
            {"id": "profile-desc", "type": "text", "props": {"text": "专注 AI 原生设计工具方向，擅长界面设计与设计系统建设。"}, "style": {"align": "center", "color": "text-secondary", "fontSize": 13}},
            _frame("profile-stats",
                [
                    {"id": "profile-s1", "type": "component", "componentType": "stat-block", "props": {"label": "项目", "value": "36"}},
                    {"id": "profile-s2", "type": "component", "componentType": "stat-block", "props": {"label": "获赞", "value": "2.4k"}},
                    {"id": "profile-s3", "type": "component", "componentType": "stat-block", "props": {"label": "粉丝", "value": "890"}},
                ],
                layout="row", gap=16,
            ),
            {"id": "profile-btn", "type": "component", "componentType": "button", "props": {"text": "编辑资料", "variant": "primary"}, "style": {"width": 200, "height": 40}},
        ],
        layout="column", gap=16, background="background", padding=32, width=560, radius=12,
    ),
    "article": _frame(
        "article-root",
        [
            _title("article-title", "AI 原生产品设计工具：2026 设计趋势解读", 2),
            {"id": "article-meta", "type": "text", "props": {"text": "发布于 2026-09-01 · 阅读 3 分钟"}, "style": {"color": "text-light", "fontSize": 12}},
            {"id": "article-cover", "type": "component", "componentType": "image", "props": {"alt": "文章封面"}, "style": {"width": 640, "height": 320}},
            {"id": "article-p1", "type": "text", "props": {"text": "2026 年，产品设计工具正经历深刻重构。自然语言驱动的设计流程让设计师从重复劳动中解放，把精力投入真正有创造力的决策。"}, "style": {"color": "text-secondary"}},
            {"id": "article-divider", "type": "component", "componentType": "divider", "props": {}},
            {"id": "article-p2", "type": "text", "props": {"text": "Design as Code 让设计稿与可运行代码同源生成，设计资产成为可持续演化的工程资产。"}, "style": {"color": "text-secondary"}},
        ],
        layout="column", gap=12, background="background", padding=32, width=680,
    ),
}

TEMPLATE_KEYS = list(TEMPLATES.keys())

# 关键词 → 模板（意图解析兜底，v2.2 §4.4：模板不匹配时兜底 landing）
KEYWORD_MAP: list[tuple[list[str], str]] = [
    (["登录", "注册", "signin", "login", "欢迎回来"], "login"),
    (["落地", "首页", "推广", "landing", "营销"], "landing"),
    (["电商", "优惠", "券", "购物", "商城", "ecommerce", "618"], "ecommerce"),
    (["仪表", "数据", "分析", "dashboard", "报表", "大屏"], "dashboard"),
    (["表单", "登记", "form", "填写", "问卷", "报名"], "form"),
    (["列表", "订单", "搜索", "list", "管理"], "list"),
    (["个人", "profile", "中心", "主页"], "profile"),
    (["文章", "内容", "article", "博客", "资讯"], "article"),
]


def match_template(prompt: str, llm_template: str | None = None) -> str:
    """模板匹配：LLM 结果优先（8 选 1），失败用关键词，兜底 landing。"""
    if llm_template in TEMPLATES:
        return llm_template
    lowered = prompt.lower()
    for keywords, name in KEYWORD_MAP:
        if any(k.lower() in lowered for k in keywords):
            return name
    return "landing"


def free_default_design(prompt: str) -> dict[str, Any]:
    """自由生成兜底稿（E3-1：mock / LLM 失败时）：不经过 8 个模板，按关键词生成通用结构。

    仅保证"可渲染 + 令牌合规 + 组件类型在白名单内"，真实场景由 LLM 生成完整树。
    """
    if any(k in prompt for k in ("设置", "配置", "偏好")):
        return _frame(
            "free-root",
            [
                _title("free-title", "偏好设置", 2),
                _frame(
                    "free-form",
                    [
                        {"id": "free-acc", "type": "component", "componentType": "input", "props": {"label": "账号", "placeholder": "请输入账号"}, "style": {"width": 320}},
                        {"id": "free-notify", "type": "component", "componentType": "select", "props": {"label": "通知方式", "placeholder": "请选择", "options": ["邮件", "短信", "站内信"]}, "style": {"width": 320}},
                        {"id": "free-save", "type": "component", "componentType": "button", "props": {"text": "保存设置", "variant": "primary"}, "style": {"width": 320, "height": 40}},
                    ],
                    layout="column", gap=12, background="#FFFFFF", padding=20, radius=12, width=360,
                ),
            ],
            layout="column", gap=20, background="background", padding=32, width=520,
        )
    return _frame(
        "free-root",
        [
            {"id": "free-nav", "type": "component", "componentType": "navbar", "props": {"title": "产品名", "links": [{"label": "功能", "href": "#"}, {"label": "案例", "href": "#"}, {"label": "关于", "href": "#"}]}},
            {"id": "free-hero", "type": "component", "componentType": "hero", "props": {"title": "从一句话到设计稿", "subtitle": "AI 原生的产品设计工具，输入需求即可生成可编辑界面", "cta": {"text": "开始体验"}}},
            _frame(
                "free-cards",
                [
                    {"id": "free-c1", "type": "component", "componentType": "card", "props": {"title": "自然语言生成", "content": "描述需求，AI 生成高保真初稿"}},
                    {"id": "free-c2", "type": "component", "componentType": "card", "props": {"title": "设计规范约束", "content": "令牌体系保证风格一致"}},
                    {"id": "free-c3", "type": "component", "componentType": "card", "props": {"title": "一键转代码", "content": "设计稿直接导出前端代码"}},
                ],
                layout="row", gap=16, padding=24,
            ),
        ],
        layout="column", gap=0, background="background", width=720,
    )
