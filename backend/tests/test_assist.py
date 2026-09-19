"""智能布局优化（E3-2）+ 组件智能推荐（E3-3）测试：规则、硬约束（内容/颜色/类型不动）、接口。"""

import copy

from app.services.optimizer import optimize_layout
from app.services.recommender import recommend_components


def _three_buttons(paddings: list[int]) -> dict:
    """同一容器内 3 个按钮，padding 各异。"""
    return {
        "id": "root", "type": "frame", "style": {"layout": "column"},
        "children": [
            {"id": "b1", "type": "component", "componentType": "button", "props": {"text": "按钮一"}, "style": {"padding": paddings[0], "width": 120, "color": "primary"}},
            {"id": "b2", "type": "component", "componentType": "button", "props": {"text": "按钮二"}, "style": {"padding": paddings[1], "width": 200, "color": "primary"}},
            {"id": "b3", "type": "component", "componentType": "button", "props": {"text": "按钮三"}, "style": {"padding": paddings[2], "width": 160, "color": "primary"}},
            {"id": "t1", "type": "text", "props": {"text": "标题不能变"}, "style": {"color": "#FF6B6B", "align": "center"}},
        ],
    }


class TestOptimizer:
    def test_unifies_padding_across_same_type_siblings(self):
        """验收：3 个按钮 padding 改不同 → 优化后一致。"""
        design, report = optimize_layout(_three_buttons([12, 16, 20]))
        p = [c["style"]["padding"] for c in design["children"] if c["id"].startswith("b")]
        assert len(set(p)) == 1
        assert report["spacing"] >= 2

    def test_unifies_size_across_same_type_siblings(self):
        design, report = optimize_layout(_three_buttons([12, 12, 12]))
        w = [c["style"]["width"] for c in design["children"] if c["id"].startswith("b")]
        assert len(set(w)) == 1
        assert report["size"] >= 2

    def test_content_and_color_untouched(self):
        """硬约束：文本、颜色、组件类型一律不动。"""
        design, _ = optimize_layout(_three_buttons([12, 16, 20]))
        assert design["children"][3]["props"]["text"] == "标题不能变"
        assert design["children"][3]["style"]["color"] == "#FF6B6B"
        assert design["children"][3]["style"]["align"] == "center"  # 不同类型（text）不与按钮分组
        assert all(c["componentType"] == "button" for c in design["children"][:3])
        assert all(c["props"]["text"].startswith("按钮") for c in design["children"][:3])

    def test_align_unified_within_same_type_group(self):
        design = {
            "id": "root", "type": "frame",
            "children": [
                {"id": "a", "type": "text", "props": {"text": "a"}, "style": {"align": "left"}},
                {"id": "b", "type": "text", "props": {"text": "b"}, "style": {"align": "right"}},
                {"id": "c", "type": "text", "props": {"text": "c"}, "style": {"align": "center"}},
            ],
        }
        optimized, report = optimize_layout(design)
        aligns = {c["style"]["align"] for c in optimized["children"]}
        assert len(aligns) == 1
        assert report["align"] >= 2

    def test_padding_normalized_to_spacing_steps(self):
        design = {"id": "root", "type": "frame", "style": {"padding": 13}, "children": []}
        optimized, report = optimize_layout(design)
        assert optimized["style"]["padding"] == 12
        assert report["spacing"] == 1

    def test_consistent_design_unchanged(self):
        _design, _report = optimize_layout(_three_buttons([12, 12, 12]))
        # 三按钮 padding 一致、width 不一致 → size 会被改；去掉 width 差异后全一致
        clean = {
            "id": "root", "type": "frame",
            "children": [
                {"id": "b1", "type": "component", "componentType": "button", "props": {"text": "1"}, "style": {"padding": 12}},
                {"id": "b2", "type": "component", "componentType": "button", "props": {"text": "2"}, "style": {"padding": 12}},
            ],
        }
        _, clean_report = optimize_layout(clean)
        assert clean_report["total"] == 0

    def test_input_design_not_mutated(self):
        original = _three_buttons([12, 16, 20])
        snapshot = copy.deepcopy(original)
        optimize_layout(original)
        assert original == snapshot  # 输入不被修改（前端保留撤销快照依赖此语义）


    def test_non_scalar_layout_values_do_not_crash(self):
        """异常值形状（dict）不能让优化器崩——2026-09-17 实测过 `TypeError: unhashable type: 'dict'`。

        该端点（POST /api/optimize-layout）**不校验入参 Schema**，而 `_unify_group` 里用了
        `set(values)` / `Counter(values)`；只要同类型兄弟里出现一个 dict/list 形状的
        width/padding/align/height，就会一路抛到接口层变成 500。
        口径：这种组**整组跳过**（宁可少优化，也不要 500 或瞎改），其它组照旧。
        """
        design = {
            "id": "root", "type": "frame",
            "children": [
                {"id": "a", "type": "text", "props": {"text": "a"}, "style": {"width": {"bad": 1}}},
                {"id": "b", "type": "text", "props": {"text": "b"}, "style": {"width": 100}},
                {"id": "c", "type": "text", "props": {"text": "c"}, "style": {"width": 160}},
            ],
        }
        optimized, report = optimize_layout(design)
        assert [c["style"]["width"] for c in optimized["children"]] == [{"bad": 1}, 100, 160]
        assert report["size"] == 0

    def test_broken_group_does_not_block_other_groups(self):
        """一组异常只影响它自己：异常组跳过，正常组照旧统一。"""
        design = {
            "id": "root", "type": "frame",
            "children": [
                {"id": "f1", "type": "frame", "style": {"padding": [1, 2]}},
                {"id": "f2", "type": "frame", "style": {"padding": 16}},
                {"id": "b1", "type": "component", "componentType": "button", "props": {"text": "1"}, "style": {"padding": 12}},
                {"id": "b2", "type": "component", "componentType": "button", "props": {"text": "2"}, "style": {"padding": 20}},
            ],
        }
        optimized, report = optimize_layout(design)
        by_id = {c["id"]: c for c in optimized["children"]}
        assert by_id["f1"]["style"]["padding"] == [1, 2]  # 异常组原样
        assert by_id["b1"]["style"]["padding"] == by_id["b2"]["style"]["padding"] == 12
        assert report["spacing"] == 1


class TestRecommender:
    def test_empty_container_recommends_text_image_button(self):
        """验收：选中空卡片 → 推荐文本 + 按钮 + 图片等。"""
        design = {"id": "root", "type": "frame", "children": [{"id": "card", "type": "frame", "style": {"layout": "column"}}]}
        recs = recommend_components(design, "card")
        assert len(recs) == 3
        assert [r["component_type"] for r in recs] == ["title-text", "image", "button"]
        assert all(r["target_id"] == "card" for r in recs)
        assert recs[0]["suggested_index"] == 0
        assert all("reason" in r and r["reason"] for r in recs)
        assert all("default_props" in r for r in recs)

    def test_navbar_component_recommends_suite_at_parent(self):
        """验收：选中导航栏 → 推荐 logo/菜单/搜索/头像（插到父容器该组件之后）。"""
        design = {
            "id": "root", "type": "frame",
            "children": [
                {"id": "nav", "type": "component", "componentType": "navbar", "props": {"title": "商城"}},
                {"id": "body", "type": "frame"},
            ],
        }
        recs = recommend_components(design, "nav")
        assert len(recs) == 3
        assert [r["component_type"] for r in recs] == ["title-text", "input", "avatar"]
        assert all(r["target_id"] == "root" for r in recs)
        assert [r["suggested_index"] for r in recs] == [1, 2, 3]

    def test_form_container_recommends_submit(self):
        design = {
            "id": "root", "type": "frame",
            "children": [
                {"id": "f", "type": "frame",
                 "children": [{"id": "i1", "type": "component", "componentType": "input", "props": {"label": "姓名"}}]},
            ],
        }
        recs = recommend_components(design, "f")
        assert recs[0]["component_type"] == "button"
        assert recs[0]["default_props"]["text"] == "提交"

    def test_form_container_recommends_switch(self):
        """T9：表单容器追加 switch 推荐（订阅/协议类确认项）。"""
        design = {
            "id": "root", "type": "frame",
            "children": [
                {"id": "f", "type": "frame",
                 "children": [{"id": "i1", "type": "component", "componentType": "input", "props": {"label": "姓名"}}]},
            ],
        }
        recs = recommend_components(design, "f")
        # T9.1 #22 口径：表单容器 4 条（追加而非替换），switch 位于末位
        assert len(recs) == 4
        assert recs[-1]["component_type"] == "switch"
        assert recs[0]["component_type"] == "button"  # 既有首条不回退

    def test_nav_container_recommends_icon(self):
        """批次 5：导航容器追加 icon 推荐（3→4 条，图标点缀导航项）。"""
        design = {
            "id": "root", "type": "frame",
            "children": [
                {"id": "nav", "type": "component", "componentType": "navbar", "props": {"title": "商城"}},
                {"id": "content", "type": "frame"},
            ],
        }
        recs = recommend_components(design, "root")  # 选中含 navbar 的容器
        assert len(recs) == 4
        assert "icon" in [r["component_type"] for r in recs]
        # 精确匹配是刻意收紧：推荐 props 应仅含场景默认值。
        # 若要新增推荐默认字段，需先更新此断言并评估所有分支。
        icon_rec = next(r for r in recs if r["component_type"] == "icon")
        assert icon_rec["default_props"] == {"name": "home"}  # 导航场景适配（覆盖 library 的 star）

    def test_hero_container_recommends_navbar_only(self):
        """批次 5：容器含营销大图而缺导航 → 只推 navbar 一条（结构缺陷补齐，不凑数）。"""
        design = {
            "id": "root", "type": "frame",
            "children": [{"id": "hero", "type": "component", "componentType": "hero", "props": {}}],
        }
        recs = recommend_components(design, "root")
        assert len(recs) == 1
        assert recs[0]["component_type"] == "navbar"
        assert recs[0]["default_props"]["title"] == "品牌名"

    def test_hero_branch_skipped_when_navbar_present(self):
        """批次 5：navbar+hero 同存 → 走导航分支（4 条含 icon），navbar 不重复出现。
        ⚠️ 分支顺序是隐式 pre-check：调整 recommender 分支顺序会让本用例红。"""
        design = {
            "id": "root", "type": "frame",
            "children": [
                {"id": "nav", "type": "component", "componentType": "navbar", "props": {"title": "商城"}},
                {"id": "hero", "type": "component", "componentType": "hero", "props": {}},
            ],
        }
        recs = recommend_components(design, "root")
        assert len(recs) == 4
        assert [r["component_type"] for r in recs] == ["input", "avatar", "tag", "icon"]
        assert sum(1 for r in recs if r["component_type"] == "navbar") == 0

    def test_product_container_recommends_tabs(self):
        """T9：详情/商品容器追加 tabs 推荐（详情/评价分组）。"""
        design = {
            "id": "root", "type": "frame",
            "children": [
                {"id": "p", "type": "frame",
                 "children": [
                     {"id": "img", "type": "component", "componentType": "image", "props": {}},
                     {"id": "btn", "type": "component", "componentType": "button", "props": {"text": "购买"}},
                 ]},
            ],
        }
        recs = recommend_components(design, "p")
        # T9.1 #22 口径：商品/详情容器 4 条（追加而非替换），tabs 位于末位
        assert len(recs) == 4
        assert recs[-1]["component_type"] == "tabs"

    def test_stat_container_recommends_chart(self):
        design = {
            "id": "root", "type": "frame",
            "children": [
                {"id": "d", "type": "frame",
                 "children": [{"id": "s", "type": "component", "componentType": "stat-block", "props": {"label": "营收"}}]},
            ],
        }
        recs = recommend_components(design, "d")
        assert recs[0]["component_type"] == "chart"

    def test_unknown_container_returns_empty(self):
        design = {"id": "root", "type": "frame"}
        assert recommend_components(design, "nope") == []

    def test_recommended_types_all_in_whitelist(self):
        """推荐结果必须全部落在组件白名单内，且用例要真正走到每个推荐分支。

        T25 修正：原用例硬编码 15 种（缺 icon/switch/tabs）且只走"空容器"分支——
        `switch`/`tabs` 早已被推荐，但断言集合里没有它们，改动推荐分支也不会红（静默失效）。
        现在改为引用唯一来源 `COMPONENT_TYPE_NAMES`，并逐分支覆盖 + 断言新组件确实被推荐过。
        """
        from app.services.generate import COMPONENT_TYPE_NAMES

        def comp(cid: str, ctype: str) -> dict:
            return {"id": cid, "type": "component", "componentType": ctype, "props": {}}

        def frame(cid: str, children: list[dict]) -> dict:
            return {"id": cid, "type": "frame", "children": children}

        cases = [
            ("空容器", frame("root", [frame("c", [])]), "c"),
            ("导航容器", frame("root", [frame("nav", [comp("nb", "navbar")])]), "nav"),
            ("表单容器", frame("root", [frame("form", [comp("in", "input")])]), "form"),
            ("数据容器", frame("root", [frame("data", [comp("sb", "stat-block")])]), "data"),
            ("图文容器", frame("root", [frame("cardbox", [comp("im", "image"), comp("bt", "button")])]), "cardbox"),
            ("组件自身（配套推荐）", frame("root", [comp("nav2", "navbar")]), "nav2"),
        ]
        seen: set[str] = set()
        for label, design, container in cases:
            recs = recommend_components(design, container)
            assert recs, f"{label} 未产出推荐（分支未被走到）"
            for item in recs:
                ctype = item["component_type"]
                assert ctype in COMPONENT_TYPE_NAMES, f"{label} 推荐了白名单外组件：{ctype}"
                seen.add(ctype)
        assert {"switch", "tabs"} <= seen, f"新组件推荐分支未被覆盖，实际覆盖：{sorted(seen)}"


class TestAssistApi:
    def test_optimize_endpoint(self, client, auth_headers):
        resp = client.post("/api/optimize-layout", json={"design": _three_buttons([12, 16, 20])}, headers=auth_headers)
        assert resp.status_code == 200
        body = resp.json()
        assert body["report"]["total"] > 0
        p = [c["style"]["padding"] for c in body["design"]["children"] if c["id"].startswith("b")]
        assert len(set(p)) == 1

    def test_optimize_endpoint_tolerates_broken_style_values(self, client, auth_headers):
        """接口层守门：异常值形状不能打成 500（该端点不校验入参 Schema）。

        2026-09-17 实测：`{"width": {"bad": 1}}` → `TypeError: unhashable type: 'dict'`
        → 未捕获 → HTTP 500。修法见 services/optimizer.py 的"值形状体检"。
        """
        design = {
            "id": "root", "type": "frame",
            "children": [
                {"id": "a", "type": "text", "props": {"text": "a"}, "style": {"width": {"bad": 1}}},
                {"id": "b", "type": "text", "props": {"text": "b"}, "style": {"width": 100}},
            ],
        }
        resp = client.post("/api/optimize-layout", json={"design": design}, headers=auth_headers)
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert [c["style"]["width"] for c in body["design"]["children"]] == [{"bad": 1}, 100]
        assert body["report"]["total"] == 0

    def test_recommend_endpoint(self, client, auth_headers):
        design = {"id": "root", "type": "frame", "children": [{"id": "card", "type": "frame"}]}
        resp = client.post("/api/recommend-components", json={"design": design, "container_id": "card"}, headers=auth_headers)
        assert resp.status_code == 200
        assert len(resp.json()["recommendations"]) == 3

    def test_recommend_endpoint_404(self, client, auth_headers):
        resp = client.post("/api/recommend-components", json={"design": {"id": "root", "type": "frame"}, "container_id": "ghost"}, headers=auth_headers)
        assert resp.status_code == 404
