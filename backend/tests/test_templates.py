"""T15：内置模板启用新组件（icon / switch / tabs）的护栏测试。

- 每个内置模板至少出现一个 T9 新组件（防止将来又被清空——模板是"点模板起手"的演示基线）；
- 全部 icon 的 props.name 必须命中 shared/icon-library.json 白名单
  （不在白名单不会报错、只会静默兜底成 help-circle —— 这正是要断言的原因）；
- 全量模板过 DesignNode Schema（新增节点的 props 合法性的结构性兜底）。
"""
import json
from pathlib import Path

from app.design.validator import validate_design
from app.services.generate import icon_names
from app.services.templates import TEMPLATES

ROOT = Path(__file__).resolve().parent.parent.parent
SHARED_ICONS = json.loads((ROOT / "shared" / "icon-library.json").read_text(encoding="utf-8"))

NEW_COMPONENTS = {"icon", "switch", "tabs"}


def _walk(node: dict):
    yield node
    for child in node.get("children") or []:
        yield from _walk(child)


class TestTemplatesUseNewComponents:
    def test_every_template_has_at_least_one_new_component(self):
        """T15 验收：8 个内置模板中 icon/switch/tabs 各不再是 0 处，且每个模板至少 1 个。"""
        counts: dict[str, int] = {k: 0 for k in NEW_COMPONENTS}
        per_template: dict[str, set[str]] = {}
        for name, tree in TEMPLATES.items():
            hit = {
                n.get("componentType")
                for n in _walk(tree)
                if n.get("type") == "component" and n.get("componentType") in NEW_COMPONENTS
            }
            per_template[name] = hit
            for c in hit:
                counts[c] += 1
        for c, n in counts.items():
            assert n > 0, f"新组件 {c} 在全部模板中仍为 0 处"
        for name, hit in per_template.items():
            assert hit, f"模板 {name} 未包含任何新组件（icon/switch/tabs）"

    def test_all_template_icon_names_are_whitelisted(self):
        """静默失败防线：模板里所有 icon.name 必须命中白名单（否则渲染成 help-circle）。"""
        names = []
        for tree in TEMPLATES.values():
            for n in _walk(tree):
                if n.get("componentType") == "icon":
                    names.append((n.get("props") or {}).get("name"))
        assert names, "模板中未找到 icon 节点"
        allowed = set(icon_names())
        assert {i["name"] for i in SHARED_ICONS["icons"]} == allowed  # 白名单来源一致
        bad = [n for n in names if n not in allowed]
        assert not bad, f"模板 icon.name 不在白名单：{bad}"

    def test_all_templates_pass_schema(self):
        for tree in TEMPLATES.values():
            validate_design(tree)  # 不合法会抛 SchemaError
