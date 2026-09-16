"""input 控件级样式：只告警、不改值、**不计违规**（2026-09-16 导出产物验收）。"""
import logging

from app.services.compliance import enforce_compliance


def _input(style: dict) -> dict:
    return {"id": "i1", "type": "component", "componentType": "input", "props": {"placeholder": "账号"}, "style": style}


class TestInputControlStyleWarning:
    def test_warns_but_keeps_style_and_not_counted(self, caplog):
        design = {"id": "root", "type": "frame", "children": [_input({"height": 48, "border": "1px solid #ddd", "width": 320})]}
        with caplog.at_level(logging.WARNING, logger="ai.gen"):
            fixed, fixes, total = enforce_compliance(design)

        assert any("控件级样式" in r.message for r in caplog.records), "应记一条可排查的告警"
        assert fixed["children"][0]["style"] == {"height": 48, "border": "1px solid #ddd", "width": 320}, "不得改值"
        assert fixes == [] and total == 0, "不计违规：不能扰动 ≥85% 那个指标"

    def test_color_violation_still_scored_normally(self, caplog):
        """同一棵树里，颜色违规照旧计分——两条口径互不影响。"""
        design = {
            "id": "root",
            "type": "frame",
            "children": [_input({"height": 48, "color": "#123456"})],
        }
        with caplog.at_level(logging.WARNING, logger="ai.gen"):
            _fixed, fixes, total = enforce_compliance(design)
        assert total == 1, "只统计颜色字段"
        assert len(fixes) == 1 and fixes[0].field == "color"

    def test_other_components_not_warned(self, caplog):
        """控件级样式只对 input 是问题；button/card 上写 height 属正常设计。"""
        design = {
            "id": "root",
            "type": "frame",
            "children": [
                {"id": "b1", "type": "component", "componentType": "button", "props": {"text": "提交"}, "style": {"height": 40}},
            ],
        }
        with caplog.at_level(logging.WARNING, logger="ai.gen"):
            enforce_compliance(design)
        assert not [r for r in caplog.records if "控件级样式" in r.message]

    def test_input_without_control_keys_not_warned(self, caplog):
        design = {"id": "root", "type": "frame", "children": [_input({"width": 320, "background": "background"})]}
        with caplog.at_level(logging.WARNING, logger="ai.gen"):
            enforce_compliance(design)
        assert not [r for r in caplog.records if "控件级样式" in r.message]
