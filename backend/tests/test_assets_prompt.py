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
