"""T23：结构化增量（ops）——六种 op、整批原子拒绝、与 T16 闸门联动、整树兼容路径。"""
import json

from app.config import get_settings
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

    def test_non_list_ops_rejected(self):
        """ops 不是数组：拒绝（不是崩），原树原样。"""
        for bad in ({"op": "set_text"}, "set_text", None):
            tree, _, _, reason = apply_ops(CURRENT, bad)
            assert reason and "数组" in reason, bad
            assert tree == CURRENT

    def test_empty_ops_is_a_legal_noop(self):
        """空 ops 是提示词明确要求的"无改动"表达 → 合法结果，不是失败。

        2026-09-17 真实模型实测：用户问「这个页面现在是什么风格？」，DeepSeek 按
        ops_prompt_section 的"无改动时返回空数组"返回 {"ops":[]}，旧实现却按非法拒绝，
        前端显示「⚠️ 修改失败（画布保持原样）原因：AI 修改指令无法落地（ops 必须是非空数组…）」。
        """
        tree, affected, removed, reason = apply_ops(CURRENT, [])
        assert reason == ""
        assert tree == CURRENT and affected == [] and removed == set()

        result = generate_design("这个页面现在是什么风格？", LLMClient(mock_responder=_responder([])), current_design=CURRENT)
        assert result.fallback is False, result.error
        assert result.error == ""
        assert result.design == CURRENT
        assert result.ops_applied == []

    def test_insert_duplicate_id_rejected(self):
        """重复 id 会让节点定位（前端查找/选中、Yjs、导出 key）全部歧义，必须在 ops 层挡掉。"""
        cases = [
            {"id": "title", "type": "text"},  # 与现有节点同 id
            {"id": "fresh", "type": "frame", "children": [{"id": "buy", "type": "text"}]},  # 子树里撞已有 id
            {"id": "n1", "type": "frame", "children": [{"id": "n1", "type": "text"}]},  # 自身内部重复
        ]
        for node in cases:
            tree, _, _, reason = apply_ops(CURRENT, [{"op": "insert", "parent": "root", "index": 0, "node": node}])
            assert reason and "已存在" in reason, node
            assert tree == CURRENT

    def test_move_index_must_be_integer(self):
        """index 不是整数时旧实现会抛 TypeError/ValueError → 接口层 502
        「AI 生成失败：int() argument must be a string…」（实测）。现在必须按可读原因整批拒绝。
        """
        for bad in (None, "0", "abc", 1.5, True):
            tree, _, _, reason = apply_ops(
                CURRENT, [{"op": "move", "id": "title", "parent": "root", "index": bad}]
            )
            assert reason and "整数" in reason, bad
            assert tree == CURRENT

        result = generate_design(
            "把标题挪到最后",
            LLMClient(mock_responder=_responder([{"op": "move", "id": "title", "parent": "root", "index": None}])),
            current_design=CURRENT,
        )
        assert result.fallback is True
        assert "无法落地" in result.error and "整数" in result.error
        assert result.design == CURRENT


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

    def test_move_into_own_subtree_is_rejected(self):
        """2026-09-17 实测复现的 P1：移到自己的后代（或自己）下面 → 子树会**凭空消失**。

        根因：`siblings.pop()` 先把子树摘掉，再把节点插进"已脱离主树"的旧引用里。
        前端 `designStore.moveNodeTo` 一直有防环守卫，服务端 ops 引擎漏了。
        """
        tree = {
            "id": "root",
            "type": "frame",
            "children": [
                {"id": "a", "type": "frame", "children": [{"id": "a1", "type": "text", "props": {"text": "内层"}}]},
                {"id": "b", "type": "text", "props": {"text": "兄弟"}},
            ],
        }
        for parent in ("a1", "a"):  # 后代 / 自己
            out, _affected, _removed, reason = apply_ops(tree, [{"op": "move", "id": "a", "parent": parent, "index": 0}])
            assert reason, f"parent={parent} 应被拒绝（否则丢子树）"
            assert "子节点" in reason or "自己" in reason
            assert out == tree, f"parent={parent} 拒绝后树必须原样"

    def test_move_to_sibling_parent_still_works(self):
        """护栏不能把合法的换父级一起挡掉。"""
        tree = {
            "id": "root",
            "type": "frame",
            "children": [
                {"id": "a", "type": "frame", "children": [{"id": "a1", "type": "text", "props": {"text": "内层"}}]},
                {"id": "b", "type": "frame", "children": []},
            ],
        }
        out, affected, _removed, reason = apply_ops(tree, [{"op": "move", "id": "a1", "parent": "b", "index": 0}])
        assert reason == ""
        assert "a1" in affected
        assert [c["id"] for c in out["children"][1]["children"]] == ["a1"]
        assert out["children"][0]["children"] == []

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

    def test_prompt_declares_output_shape_exactly_once(self):
        """输出形态只能由形态段规定：基础约束段不得再要求"输出完整树"。

        旧版基础段写「输出修改后的【完整 DesignNode 树】」，追加的 ops 段又写「不要再输出
        完整树」——同一个 system 里两条互斥指令，模型只能二选一（实测两种形态都出现过）。
        """
        from app.services.generate import (
            INCREMENTAL_SYSTEM,
            incremental_system,
            legacy_tree_prompt_section,
            ops_prompt_section,
        )

        assert "输出修改后的【完整 DesignNode 树】" not in INCREMENTAL_SYSTEM
        assert "（完整 DesignNode 树）" not in INCREMENTAL_SYSTEM

        ops_text = incremental_system(False)
        assert ops_prompt_section() in ops_text
        assert legacy_tree_prompt_section() not in ops_text
        assert ops_text.count("## 修改指令的输出形态") == 1

        # PROMPT_OPS_ENABLED=0（A/B 度量脚本的对照臂）→ 只出现整树形态段
        settings = get_settings()
        original = settings.prompt_ops_enabled
        settings.prompt_ops_enabled = False
        try:
            legacy_text = incremental_system(False)
        finally:
            settings.prompt_ops_enabled = original
        assert legacy_tree_prompt_section() in legacy_text
        assert ops_prompt_section() not in legacy_text
        assert legacy_text.count("## 修改指令的输出形态") == 1
        assert "输出修改后的完整 DesignNode 树" in legacy_text
