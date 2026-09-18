"""生成时读用户资产库（2026-09-17）：让模型能引用"我上传的图"，而不是编外链。"""
from app.services.generate import (
    assets_prompt_section,
    fill_system_text,
    free_system_text,
    incremental_system,
)

ASSETS = [
    {"id": 12, "name": "蓝色渐变背景", "url": "/api/images/12"},
    {"id": 13, "name": "运动鞋主图", "url": "/api/images/13"},
]


class TestAssetsPromptSection:
    def test_empty_assets_means_no_section(self):
        """没有资产就不注入——不白占提示词体积，行为与改造前逐字相同。"""
        assert assets_prompt_section(None) == ""
        assert assets_prompt_section([]) == ""
        assert "可用图片" not in fill_system_text()

    def test_lists_name_and_url(self):
        section = assets_prompt_section(ASSETS)
        assert "蓝色渐变背景 → /api/images/12" in section
        assert "运动鞋主图 → /api/images/13" in section
        # 关键约束：不许编外链（否则产物里是一堆打不开的图）
        assert "禁止编造外链" in section
        assert "没有合适的图就不要放 image 组件" in section

    def test_injected_into_all_three_system_prompts(self):
        """生成（模板/自由）与修改三条链路都要能看到资产——"换成我上传的图"是修改类指令。"""
        section = assets_prompt_section(ASSETS)
        for name, text in (
            ("fill", fill_system_text(ASSETS)),
            ("free", free_system_text(ASSETS)),
            ("incremental", incremental_system(False, ASSETS)),
        ):
            assert section in text, name

    def test_capped_at_twelve(self):
        many = [{"id": i, "name": f"图{i}", "url": f"/api/images/{i}"} for i in range(1, 30)]
        section = assets_prompt_section(many)
        assert "/api/images/12" in section
        assert "/api/images/13" not in section  # 第 13 张起不再注入（提示词体积上限）

    def test_skips_entries_without_url(self):
        section = assets_prompt_section([{"id": 1, "name": "没地址"}, *ASSETS])
        assert "没地址" not in section
        assert "/api/images/12" in section


class TestNoInventedImageUrls:
    """2026-09-18：资产库为空时，提示词里也必须有"不许编图片外链"这条。

    此前这条规则**只在"可用图片"段里**，而那一整段在 `assets` 为空时根本不注入
    （见 assets_prompt_section：没有资产就 return ""）。于是"用户没传图"的最常见情形下，
    模型可以自由编 `https://picsum.photos/...` 之类的外链——导出产物里就是一堆打不开的图，
    离线打开全裂；而 FILL_SYSTEM 第 5 条还在要求商品卡片"必须包含商品图"。
    """

    def test_rule_is_in_both_generation_prompts_without_assets(self):
        for name, text in (
            ("fill", fill_system_text()),
            ("free", free_system_text()),
        ):
            assert "禁止编造外链或占位图服务地址" in text, name
            assert "没有给任何图片时就不要写 src" in text, name
            # 前提确认：这一路确实**没有**注入"可用图片"段（否则这条用例就测不到点子上）
            assert "## 可用图片" not in text, name

    def test_rule_survives_when_assets_present(self):
        assert "禁止编造外链" in fill_system_text(ASSETS)
