"""T17：LLM 输出解包与根节点抢救（纯函数级用例）。

背景：generate.log 里 76 次 Schema 失败的原因全部是 `<root>: 'id' is a required property`——
模型把整棵树包了一层（{"design": {...}}），旧实现直接判失败并整稿回退模板。
判定口径见 `generate.unwrap_design`：只认"设计节点形状"，不许把任意 JSON 硬造成设计稿。
"""
from app.services.generate import unwrap_design

TREE = {
    "id": "root",
    "type": "frame",
    "style": {"layout": "column"},
    "children": [{"id": "t", "type": "text", "props": {"text": "标题"}}],
}


class TestUnwrapDesign:
    def test_design_key_wrapper(self):
        """① {"design": {...}} —— 最常见形态。"""
        root, source = unwrap_design({"design": TREE, "explanation": "here you go"})
        assert root == TREE
        assert source == "design"

    def test_nested_wrapper(self):
        """② 包裹键再下探一层：{"result": {"design": {...}}}。"""
        root, source = unwrap_design({"result": {"design": TREE}})
        assert root == TREE
        assert source == "result.design"

    def test_top_level_design_node(self):
        """③ 顶层就是设计树 → 原样返回，不改动内容。"""
        root, source = unwrap_design(TREE)
        assert root == TREE
        assert source == "root"

    def test_missing_root_id_rescued(self):
        """④ 形状合法但缺根 id → 补 id="root"（不修改其余字段）。"""
        root, source = unwrap_design({"type": "frame", "children": []})
        assert source == "补根 id"
        assert root == {"id": "root", "type": "frame", "children": []}

    def test_non_design_json_not_salvaged(self):
        """⑤ 完全不是设计稿的 JSON → 不抢救（否则会把任意对象造成设计稿）。"""
        root, source = unwrap_design({"explanation": "no", "steps": [{"id": "1", "type": "button"}]})
        assert root is None
        assert source == ""

    def test_depth_limit_not_salvaged(self):
        """⑥ 深度超过 2 层的包裹不抢救（防误抓：{"result": {"data": {"design": …}}}）。"""
        root, source = unwrap_design({"result": {"data": {"design": TREE}}})
        assert root is None
        assert source == ""

    def test_component_name_in_type_rescued(self):
        """⑦ 包裹里是"组件名误写进 type"的历史形态 → 抢救出来交给 repair_design 转正。"""
        root, source = unwrap_design({"design": {"id": "b1", "type": "button", "props": {"text": "按钮"}}})
        assert source == "design"
        assert root == {"id": "b1", "type": "button", "props": {"text": "按钮"}}
