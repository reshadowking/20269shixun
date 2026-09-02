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
        # 与 FREE_SYSTEM 组件白名单一致（15 种）
        whitelist = {
            "button", "card", "input", "select", "table", "chart", "stat-block",
            "navbar", "sidebar", "avatar", "tag", "divider", "title-text", "hero", "image",
        }
        design = {"id": "root", "type": "frame", "children": [{"id": "c", "type": "frame"}]}
        for container in ["c", "root"]:
            for r in recommend_components(design, container):
                assert r["component_type"] in whitelist


class TestAssistApi:
    def test_optimize_endpoint(self, client, auth_headers):
        resp = client.post("/api/optimize-layout", json={"design": _three_buttons([12, 16, 20])}, headers=auth_headers)
        assert resp.status_code == 200
        body = resp.json()
        assert body["report"]["total"] > 0
        p = [c["style"]["padding"] for c in body["design"]["children"] if c["id"].startswith("b")]
        assert len(set(p)) == 1

    def test_recommend_endpoint(self, client, auth_headers):
        design = {"id": "root", "type": "frame", "children": [{"id": "card", "type": "frame"}]}
        resp = client.post("/api/recommend-components", json={"design": design, "container_id": "card"}, headers=auth_headers)
        assert resp.status_code == 200
        assert len(resp.json()["recommendations"]) == 3

    def test_recommend_endpoint_404(self, client, auth_headers):
        resp = client.post("/api/recommend-components", json={"design": {"id": "root", "type": "frame"}, "container_id": "ghost"}, headers=auth_headers)
        assert resp.status_code == 404
