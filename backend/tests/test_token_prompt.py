"""令牌**色值**注入提示词（2026-09-18）。

背景（任务卡 §三·A 第 2 条登记的 SKILL/实现不一致）：三段 system 一直只要求模型
"颜色优先使用令牌名"，却从没告诉它名字对应的颜色——模型不知道 primary 是深蓝、
secondary 是紫，写"红色调"时可能把主色套在 primary 上。

口径：值只从唯一规范源（`shared/design-system.yaml` 的生成物）取，提示词里不手抄 hex；
只注入画布真正使用的那套主题（styleToCss.ts 固定 default）。
"""
from app.design import tokens as design_tokens
from app.services.generate import (
    fill_system_text,
    free_system_text,
    incremental_system,
    token_prompt_section,
)


class TestTokenPromptSection:
    def test_lists_every_default_theme_token_with_its_value(self):
        section = token_prompt_section()
        for name, value in design_tokens.COLORS["default"].items():
            assert f"{name}（{value}）" in section, name
        assert "设计令牌的实际颜色" in section

    def test_values_come_from_the_single_source_not_hardcoded(self, monkeypatch):
        """改令牌 → 提示词跟着变（否则就是又抄了一份 hex，迟早漂移）。"""
        monkeypatch.setitem(design_tokens.COLORS["default"], "danger", "#123456")
        assert "danger（#123456）" in token_prompt_section()

    def test_injected_into_all_three_system_prompts(self):
        section = token_prompt_section()
        for name, text in (
            ("fill", fill_system_text()),
            ("free", free_system_text()),
            ("incremental", incremental_system(False)),
        ):
            assert section in text, name

    def test_tells_model_to_use_names_not_self_invented_hex(self):
        section = token_prompt_section()
        assert "不要自创 hex" in section
        # 用户给了品牌 hex 时仍按 FILL_SYSTEM 的既有规则走（令牌表不覆盖它）
        assert "原样使用该 hex" in section

    def test_only_default_theme_is_injected(self):
        """画布固定用 default 主题渲染，注入两套值会让模型选到渲染不出来的那套。"""
        section = token_prompt_section()
        dark_primary = design_tokens.COLORS["dark"]["primary"]
        assert design_tokens.COLORS["default"]["primary"] != dark_primary  # 前提：两套值确实不同
        assert dark_primary not in section
