"""T18：组件字段契约注入（shared/component-library.json → 三段 system）+ 契约外字段日志。

防漂移口径与 T9 图标清单一致：**追加假字段 → 三段提示词同步出现**，证明是运行期注入而非手抄。
"""
import logging

from app.services import generate
from app.services.generate import (
    COMPONENT_TYPE_NAMES,
    component_contract_section,
    component_prop_names,
    fill_system_text,
    free_system_text,
    incremental_system,
    repair_design,
)

MAX_SECTION_CHARS = 2500


def _three_prompts() -> list[tuple[str, str]]:
    return [
        ("FILL", fill_system_text()),
        ("FREE", free_system_text()),
        ("INCREMENTAL", incremental_system(False)),
    ]


class TestComponentContractInjection:
    def test_three_systems_contain_contract(self):
        for name, text in _three_prompts():
            assert "可用组件与字段" in text, f"{name} 缺组件契约段"
            assert "字段名写错不会报错" in text, f"{name} 缺契约提示语"

    def test_fake_prop_reaches_all_three_prompts(self):
        """追加假字段 → 三段提示词同步出现；移除后同步消失（读取而非抄写）。"""
        spec = generate.COMPONENT_LIBRARY["components"][0]["props"]
        spec["测试假字段"] = {"type": "string", "default": "x", "description": "假"}
        try:
            for name, text in _three_prompts():
                assert "测试假字段" in text, f"{name} 未随组件库同步"
        finally:
            del spec["测试假字段"]
        for name, text in _three_prompts():
            assert "测试假字段" not in text, f"{name} 移除假字段后仍残留"

    def test_all_18_component_types_covered(self):
        section = component_contract_section()
        for component_type in sorted(COMPONENT_TYPE_NAMES):
            assert f"- {component_type} " in section, f"契约段缺组件 {component_type}"

    def test_section_size_budget(self):
        """体积护栏：超限时压缩格式，不许删组件（评测 prompt 预算相关）。"""
        assert len(component_contract_section()) <= MAX_SECTION_CHARS

    def test_default_style_not_injected(self):
        """只注 props：default_style 的键/值一律不进提示词（含 T19 要修的 background:"card"）。"""
        section = component_contract_section()
        for leaked in ("default_style", "radius", "padding", "border", "fontSize", "#FFFFFF", "boxShadow"):
            assert leaked not in section, f"契约段泄漏了 default_style 相关字面量：{leaked}"

    def test_structure_shapes_rendered_from_library(self):
        """结构性字段给出结构（空默认值的对象数组也要给出形状）——这是本卡的核心收益。"""
        section = component_contract_section()
        assert "- table " in section and "columns=[{key,title}]" in section
        assert "rows=[{key:value}]" in section
        assert "data=[{xKey:yKey}]" in section
        assert "chartType=line|bar|pie" in section
        assert "cta={text}" in section  # hero 的对象字段

    def test_applicable_scene_injected_for_every_component(self):
        """T51：库里现成的"适用场景"description 必须进契约段。

        模型选组件全靠猜是 A 类"结构不对"最可能的根因之一，而这个数据本来就在
        （card: "承载图文内容的容器"）——不注入等于白带着不用。
        """
        from app.services.generate import COMPONENT_LIBRARY

        for spec in COMPONENT_LIBRARY["components"]:
            desc = spec.get("description")
            assert desc, f"{spec['type']} 缺 description（组件库数据完整性）"
            section = component_contract_section()
            assert desc in section, f"{spec['type']} 的 description 没进契约段：{desc}"


class TestContractViolationLogging:
    """契约外字段只记日志、不改行为（行为改动属另一张卡）。"""

    def test_unknown_prop_warns_without_changing_tree(self, caplog):
        node = {
            "id": "n1",
            "type": "component",
            "componentType": "stat-block",
            "props": {"text": "写错的字段", "value": "128"},
        }
        with caplog.at_level(logging.WARNING, logger="ai.gen"):
            fixed = repair_design(node)
        assert any("契约外字段" in record.getMessage() for record in caplog.records)
        assert fixed["props"] == {"text": "写错的字段", "value": "128"}  # 不删、不改

    def test_declared_props_do_not_warn(self, caplog):
        node = {
            "id": "n2",
            "type": "component",
            "componentType": "stat-block",
            "props": {"label": "营收", "value": "128", "trend": "↑ 12.6%"},
        }
        with caplog.at_level(logging.WARNING, logger="ai.gen"):
            repair_design(node)
        assert not [r for r in caplog.records if "契约外字段" in r.getMessage()]

    def test_prop_names_come_from_library(self):
        assert component_prop_names("stat-block") == frozenset({"label", "value", "trend"})
        assert component_prop_names("table") == frozenset({"columns", "rows"})
        assert component_prop_names("no-such-type") == frozenset()

    def test_node_type_vs_component_guard_line_present(self):
        """T51 验收反馈：模型曾写 componentType: "text"（text 是节点类型）→ 三处被降级。
        契约段必须有这条反例，从源头挡住。"""
        section = component_contract_section()
        assert "不要写 componentType" in section
        assert "节点类型" in section
