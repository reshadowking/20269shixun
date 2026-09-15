"""T23：结构化增量（ops）——六种 op、整批原子拒绝、与 T16 闸门联动、整树兼容路径。"""
import json

from app.services.generate import generate_design
from app.services.llm import LLMClient
from app.services.ops import MAX_INSERT_NODES, apply_ops

CURRENT = {
    "id": "root",
    "type": "frame",
    "style": {"layout": "column", "gap": 16},
    "children": [
        {"id": "title", "type": "text", "props": {"text": "商品标题"}},
        {"id": "buy", "type": "component", "componentType": "button", "props": {"text": "加入购物车"}},
        {"id": "note", "type": "text", "props": {"text": "包邮说明"}},
    ],
}


def _responder(ops):
    class Responder:
        def __call__(self, system: str, user: str) -> str:
            return json.dumps({"ops": ops}, ensure_ascii=False) if "设计修改器" in system else ""

    return Responder()


class TestApplyOps:
    def test_oversized_insert_rejected(self):
        """T28：一条 insert 塞整页（节点数超限）→ 整批拒绝，提示拆成多条 op。"""
        big = {
            "op": "insert",
            "parent": "root",
            "index": 0,
            "node": {
                "id": "huge",
                "type": "frame",
                "children": [{"id": f"c{i}", "type": "text", "props": {"text": "x"}} for i in range(MAX_INSERT_NODES)],
            },
        }
        tree, _, _, reason = apply_ops(CURRENT, [big])
        assert tree == CURRENT
        assert "子树过大" in reason and "拆成多条" in reason

    def test_deep_insert_rejected(self):
        """T28：深度超限同样拒绝。"""
        deep: dict = {"id": "d0", "type": "frame"}
        cur = deep
        for i in range(1, 6):
            child = {"id": f"d{i}", "type": "frame"}
            cur["children"] = [child]
            cur = child
        tree, _, _, reason = apply_ops(CURRENT, [{"op": "insert", "parent": "root", "index": 0, "node": deep}])
        assert tree == CURRENT
        assert "深度" in reason

    def test_each_op_type(self):
        tree, affected, removed, reason = apply_ops(
            CURRENT,
            [
                {"op": "set_text", "id": "title", "value": "新标题"},
                {"op": "set_prop", "id": "buy", "key": "variant", "value": "primary"},
                {"op": "set_style", "id": "buy", "key": "color", "value": "danger"},
                {"op": "insert", "parent": "root", "index": 1, "node": {"type": "component", "componentType": "tag", "props": {"text": "限时"}}},
                {"op": "move", "id": "note", "parent": "root", "index": 0},
                {"op": "remove", "id": "buy"},
            ],
        )
        assert reason == ""
        by_id = {c["id"]: c for c in tree["children"]}
        assert by_id["title"]["props"]["text"] == "新标题"
        assert tree["children"][0]["id"] == "note"  # move 生效
        assert removed == {"buy"}
        assert "root-c3" in affected  # insert 派生 id（与 repair 规则一致）

    def test_rejections_are_atomic(self):
        cases = [
            [{"op": "nope", "id": "title"}],
            [{"op": "set_text", "id": "missing", "value": "x"}],
            [{"op": "set_prop", "id": "buy", "key": "level", "value": 3}],  # button 未声明 level
            [{"op": "insert", "parent": "root", "index": 99, "node": {"type": "text"}}],
            [{"op": "set_text", "id": "title"}] * 21,
        ]
        for ops in cases:
            tree, _, _, reason = apply_ops(CURRENT, ops)
            assert reason, f"应被拒绝：{ops[:1]}"
            assert tree == CURRENT


class TestOpsEndToEnd:
    def test_invalid_json_error_message_is_actionable(self):
        """T28：两次都解析失败时，错误文案要指出'不是合法 JSON'而不是误导性的'限流或超时'。"""
        result = generate_design("改点东西", LLMClient(mock_responder=lambda s, u: "不是 JSON 的一段解释文字"), current_design=CURRENT)
        assert result.fallback is True
        assert "不是合法 JSON" in result.error
        assert "限流或超时" not in result.error

    def test_ops_path_changes_only_target(self):
        result = generate_design(
            "把购买按钮改成红色",
            LLMClient(mock_responder=_responder([{"op": "set_style", "id": "buy", "key": "color", "value": "danger"}])),
            current_design=CURRENT,
        )
        assert result.fallback is False, result.error
        assert result.design["children"][1]["style"]["color"] == "danger"
        assert result.design["children"][0] == CURRENT["children"][0]  # 其余逐字段不变
        assert result.ops_applied == ["buy"]

    def test_remove_requires_explicit_op(self):
        removed = generate_design(
            "删掉说明",
            LLMClient(mock_responder=_responder([{"op": "remove", "id": "note"}])),
            current_design=CURRENT,
        )
        assert removed.fallback is False
        assert [c["id"] for c in removed.design["children"]] == ["title", "buy"]

        # 同样"少一个节点"，但不用 ops → 被 T16 闸门拒绝（画布保持原样）
        class WholeTree:
            def __call__(self, system: str, user: str) -> str:
                tree = json.loads(json.dumps(CURRENT))
                tree["children"] = [c for c in tree["children"] if c["id"] != "note"]
                return json.dumps(tree, ensure_ascii=False) if "设计修改器" in system else ""

        blocked = generate_design("删掉说明", LLMClient(mock_responder=WholeTree()), current_design=CURRENT)
        assert blocked.fallback is True
        assert blocked.design == CURRENT

    def test_illegal_ops_keep_canvas(self):
        result = generate_design(
            "删掉一个不存在的节点",
            LLMClient(mock_responder=_responder([{"op": "remove", "id": "nope"}])),
            current_design=CURRENT,
        )
        assert result.fallback is True
        assert "无法落地" in result.error
        assert result.design == CURRENT

    def test_legacy_whole_tree_still_works(self):
        class WholeTree:
            def __call__(self, system: str, user: str) -> str:
                tree = json.loads(json.dumps(CURRENT))
                tree["children"][1]["style"] = {"color": "danger"}
                return json.dumps(tree, ensure_ascii=False) if "设计修改器" in system else ""

        result = generate_design("改色", LLMClient(mock_responder=WholeTree()), current_design=CURRENT)
        assert result.fallback is False
        assert result.ops_applied == []  # 走兼容路径

    def test_prompt_declares_ops_protocol(self):
        from app.services.generate import INCREMENTAL_SYSTEM, incremental_system

        text = incremental_system(False)
        assert "输出形态" in text and "set_style" in text and "remove" in text
        # 既有语义断言逐字保留（T4/T12 依赖）
        for probe in ("背景不变", "最外层容器", "只改该组件"):
            assert probe in INCREMENTAL_SYSTEM
            assert probe in text
