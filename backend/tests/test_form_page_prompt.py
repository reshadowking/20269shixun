"""表单页三条约束（2026-09-16）：提示词必须真的注入，而不是写在文档里。"""
from app.services.generate import (
    fill_system_text,
    form_page_section,
    free_system_text,
    incremental_system,
)


class TestFormPageSection:
    def test_section_covers_three_findings(self):
        text = form_page_section()
        # ① 输入框双边框：控件级样式归组件默认样式
        assert "控件级样式" in text and "height" in text and "border" in text
        # ② 表单页初始态不得带错误态
        assert "初始态不要输出错误态文案" in text
        # ③ 正文不该用标题组件
        assert "text 类型" in text and "title-text" in text

    def test_injected_into_all_three_system_prompts(self):
        """生成（模板/自由）与修改三条链路都要带上——只改生成、修改时又写坏等于没修。"""
        section = form_page_section()
        for name, text in (
            ("fill", fill_system_text()),
            ("free", free_system_text()),
            ("incremental", incremental_system()),
        ):
            assert section in text, name

    def test_locked_incremental_still_contains_section(self):
        """锁定阶段只是追加约束段，不能把表单页约束顶掉。"""
        assert form_page_section() in incremental_system(locked=True)
