"""T9 触点 15：图标数据单一来源契约（shared/icon-library.json）。

三层手法（照 design-guard-words 的范式）：
① 后端加载结果 == JSON 文件内容（防手抄漂移）；
② 假词生效（往加载结果追加假图标 → 名字集合/提示词清单同步可见，证明是"读取"而非"抄写"）；
③ 两端对同一份名字集合给出相同结论——后端在此断言；前端对称断言见
   frontend/src/components/canvas/icon/icon.test.tsx（两端 import 同一份文件）。
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
SHARED_ICONS = json.loads((ROOT / "shared" / "icon-library.json").read_text(encoding="utf-8"))


class TestIconLibrarySharedSource:
    def test_loaded_library_matches_shared_file(self):
        """① 加载结果与 JSON 文件逐字段一致。"""
        from app.services.generate import ICON_LIBRARY

        assert ICON_LIBRARY == SHARED_ICONS

    def test_icon_names_match_shared_file(self):
        from app.services.generate import icon_names

        assert icon_names() == {i["name"] for i in SHARED_ICONS["icons"]}

    def test_icons_shape(self):
        """文件本身的自洽性：name 唯一、三字段齐备、path 是 path 数据、兜底占位在库。"""
        icons = SHARED_ICONS["icons"]
        names = [i["name"] for i in icons]
        assert len(names) == len(set(names)), "图标 name 必须唯一"
        for icon in icons:
            assert icon["name"], f"label={icon['label']} 缺 name"
            assert icon["label"], f"name={icon['name']} 缺中文 label"
            assert icon["path"].startswith(("M", "m")), f"{icon['name']} 的 path 不是路径数据"
        assert "help-circle" in names, "兜底占位 help-circle 必须在库内"

    def test_fake_icon_takes_effect(self):
        """② 证明是"读取"而非"抄写"：给加载结果追加假图标 → 名字集合/提示词清单即时可见。"""
        from app.services import generate

        generate.ICON_LIBRARY["icons"].append({"name": "布拉格", "label": "假", "path": "M0 0"})
        try:
            assert "布拉格" in generate.icon_names()
            assert "布拉格" in generate.icon_names_text()
            assert "布拉格" in generate.icon_prompt_section()
        finally:
            generate.ICON_LIBRARY["icons"].pop()
        assert "布拉格" not in generate.icon_names()
        assert "布拉格" not in generate.icon_names_text()


class TestIconNotDegraded:
    """T9 验收：icon 进白名单后不再被 T8 降级——含 icon 的树 degraded 为空、节点保持 component。"""

    def test_icon_node_stays_component(self):
        from app.services.generate import repair_design

        node = {"id": "ic", "type": "component", "componentType": "icon", "props": {"name": "star"}}
        degraded: list[str] = []
        fixed = repair_design(node, degraded)
        assert fixed == {"id": "ic", "type": "component", "componentType": "icon", "props": {"name": "star"}}
        assert degraded == []

    def test_unknown_icon_name_stays_component_but_logged(self, caplog):
        """未知名是普通 string（Schema 不拒）→ 不降级、只记 gen_logger（渲染层兜底）。"""
        import logging

        from app.services.generate import repair_design

        node = {"id": "ic", "type": "component", "componentType": "icon", "props": {"name": "不存在的图标"}}
        degraded: list[str] = []
        with caplog.at_level(logging.WARNING, logger="ai.gen"):
            fixed = repair_design(node, degraded)
        assert fixed["type"] == "component", "未知名不得触发降级"
        assert degraded == []
        assert any("未知图标名" in r.message and "不存在的图标" in r.message for r in caplog.records)

    def test_known_icon_name_not_logged(self, caplog):
        import logging

        from app.services.generate import repair_design

        node = {"id": "ic", "type": "component", "componentType": "icon", "props": {"name": "star"}}
        with caplog.at_level(logging.WARNING, logger="ai.gen"):
            repair_design(node)
        assert not [r for r in caplog.records if "未知图标名" in r.message]
