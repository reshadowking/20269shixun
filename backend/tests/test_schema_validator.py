"""Schema 校验器测试：合法节点通过、非法节点拒绝、恶意 JSON 友好报错（v2.2 §3.1 + §11.2）。"""
import pytest

from app.design.validator import SchemaError, validate_design, validate_design_safe


def _node(**overrides):
    node = {
        "id": "n1",
        "type": "frame",
        "style": {"layout": "column", "gap": 8},
        "children": [],
    }
    node.update(overrides)
    return node


class TestValidDesigns:
    def test_minimal_frame(self):
        validate_design(_node())

    def test_full_design_tree(self):
        design = {
            "id": "root",
            "type": "frame",
            "style": {"layout": "column", "gap": 16, "background": "background"},
            "children": [
                {"id": "t1", "type": "text", "props": {"text": "标题"}, "style": {"fontSize": 24}},
                {
                    "id": "c1",
                    "type": "component",
                    "componentType": "button",
                    "props": {"text": "立即领取", "variant": "default"},
                    "style": {"color": "primary"},
                },
                {
                    "id": "ch1",
                    "type": "component",
                    "componentType": "chart",
                    "props": {
                        "chartType": "line",
                        "title": "近7日营收",
                        "data": [{"day": "周一", "value": 100}, {"day": "周二", "value": 120}],
                        "xKey": "day",
                        "yKey": "value",
                    },
                },
                {
                    "id": "img1",
                    "type": "component",
                    "componentType": "image",
                    "props": {"src": "/static/images/a.png", "alt": "产品图", "fit": "cover"},
                },
            ],
        }
        validate_design(design)

    def test_free_layout_with_xy(self):
        validate_design(_node(style={"layout": "free"}, x=10, y=20))

    def test_group_nesting(self):
        validate_design(_node(type="group", children=[_node(id="inner")]))


class TestInvalidDesigns:
    def test_missing_id(self):
        with pytest.raises(SchemaError):
            validate_design({"type": "frame"})

    def test_bad_type(self):
        with pytest.raises(SchemaError):
            validate_design(_node(type="canvas"))

    def test_bad_component_type(self):
        with pytest.raises(SchemaError):
            validate_design(_node(type="component", componentType="spaghetti"))

    def test_bad_chart_type(self):
        with pytest.raises(SchemaError):
            validate_design(
                _node(
                    type="component",
                    componentType="chart",
                    props={"chartType": "scatter", "xKey": "a", "yKey": "b"},
                )
            )

    def test_bad_fit(self):
        with pytest.raises(SchemaError):
            validate_design(
                _node(type="component", componentType="image", props={"fit": "stretch"})
            )

    def test_bad_layout_enum(self):
        with pytest.raises(SchemaError):
            validate_design(_node(style={"layout": "diagonal"}))

    def test_children_not_array(self):
        with pytest.raises(SchemaError):
            validate_design(_node(children={"not": "array"}))

    def test_font_size_out_of_range(self):
        with pytest.raises(SchemaError):
            validate_design(_node(style={"fontSize": 99999}))


class TestMaliciousInputs:
    def test_top_level_not_object(self):
        for bad in [None, 42, "str", [1, 2], True]:
            ok, errors = validate_design_safe(bad)
            assert not ok and errors, f"{bad!r} 应被拒绝"

    def test_deeply_nested_json(self):
        """深度嵌套恶意 JSON：必须被 max_depth 拦截，不拖垮校验器。"""
        node = {"id": "x", "type": "frame", "children": []}
        cur = node
        for i in range(200):
            child = {"id": f"x{i}", "type": "frame", "children": []}
            cur["children"].append(child)
            cur = child
        ok, errors = validate_design_safe(node)
        assert not ok
        assert any("深度" in e for e in errors)

    def test_huge_children_array(self):
        children = [{"id": f"n{i}", "type": "text"} for i in range(1000)]
        ok, errors = validate_design_safe(_node(children=children))
        assert not ok
        assert len(errors) >= 1

    def test_overlong_strings(self):
        ok, _ = validate_design_safe(_node(props={"text": "x" * 6000}))
        assert not ok

    def test_script_content_is_just_text(self):
        """XSS 基线：script 内容在 Schema 层是合法文本（渲染层负责转义，见前端测试）。"""
        validate_design(_node(type="text", props={"text": "<script>alert(1)</script>"}))

    def test_unknown_extra_props_rejected(self):
        ok, _ = validate_design_safe(_node(sneaky_field="drop table users"))
        assert not ok
