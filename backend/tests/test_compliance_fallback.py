"""T19：合规检查器的兜底口径（非 hex 值不再被强制改成 primary / hex 归一）。

背景（本机实测）：
- `_HEX_RE` 只认 6 位 → `#fff`、`#FFFFFF80` 被判非法，兜底 `corrected = "primary"`（白底变蓝）；
- 非 hex 自由串（组件库默认值 `"card"`、CSS 关键字 `transparent`）同样被改成 `primary`。
既有决策保持不变（**用户给了品牌色时，非品牌色 hex 仍收敛到品牌色**），见 test_generate.py::TestCompliance。
"""
import logging

from app.design import tokens
from app.services.compliance import compliance_rate, enforce_compliance
from app.services.generate import COMPONENT_LIBRARY


def _design(**style):
    return {"id": "root", "type": "frame", "style": dict(style), "children": []}


class TestNonHexPassthrough:
    def test_card_token_value_not_rewritten(self):
        """组件库历史默认值 `"card"`（不是令牌）：保持原值，不改写、不计违规。"""
        fixed, fixes, total = enforce_compliance(_design(background="card"))
        assert fixed["style"]["background"] == "card"
        assert fixes == []
        assert total == 1
        assert compliance_rate(len(fixes), total) == 100.0

    def test_css_keywords_and_functions_passthrough(self):
        for value in ("transparent", "none", "currentColor", "rgba(0,0,0,0.5)", "hsl(210, 100%, 50%)"):
            fixed, fixes, _ = enforce_compliance(_design(color=value))
            assert fixes == [], f"{value} 被误判为违规"
            assert fixed["style"]["color"] == value

    def test_unknown_free_string_kept_and_logged(self, caplog):
        """拼错的令牌名等无法判定的值：保持原值 + warning，不计入 violations（不再刷成 primary）。"""
        with caplog.at_level(logging.WARNING, logger="ai.gen"):
            fixed, fixes, total = enforce_compliance(_design(color="primry"))
        assert fixed["style"]["color"] == "primry"
        assert fixes == [] and total == 1
        assert any("无法判定的颜色值" in r.getMessage() for r in caplog.records)


class TestHexNormalization:
    def test_three_digit_hex_is_legal(self):
        """`#fff` 归一为 #FFFFFF 后是白名单色 → 保留原写法（此前会被刷成 primary）。"""
        fixed, fixes, _ = enforce_compliance(_design(background="#fff"))
        assert fixes == []
        assert fixed["style"]["background"] == "#fff"

    def test_eight_digit_hex_keeps_alpha_when_legal(self):
        """`#RRGGBBAA` 按前 6 位判定：合法时保留 alpha（值本身不改写）。"""
        fixed, fixes, _ = enforce_compliance(_design(background="#FFFFFF80"))
        assert fixes == []
        assert fixed["style"]["background"] == "#FFFFFF80"

    def test_illegal_hex_still_pulled_back(self):
        """真·非法 hex 仍然拉回最近令牌（口径不放宽）——8 位写法按前 6 位同样判定。"""
        for value in ("#123456", "#12345678"):
            fixed, fixes, total = enforce_compliance(_design(color=value))
            assert len(fixes) == 1, f"{value} 应被拉回"
            assert fixed["style"]["color"] == "text-primary"
            assert total == 1


class TestComponentLibraryDefaults:
    def test_all_default_style_colors_are_legal(self):
        """组件库 default_style 里的颜色值必须全部合法（防 `"card"` 这类值再次混入）。"""
        offenders = []
        for spec in COMPONENT_LIBRARY["components"]:
            style = spec.get("default_style") or {}
            for key in ("color", "background"):
                value = style.get(key)
                if isinstance(value, str) and not tokens.is_allowed_color("default", value):
                    offenders.append(f"{spec['type']}.{key}={value}")
        assert offenders == []
