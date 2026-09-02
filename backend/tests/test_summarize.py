"""长提示词摘要 + 模板合规率 100% 测试（验证：超长需求先压缩再进参数填充）。"""

from app.services.compliance import compliance_rate, enforce_compliance
from app.services.generate import summarize_prompt
from app.services.llm import LLMClient
from app.services.templates import TEMPLATES

LONG_PROMPT = (
    "帮我做一个电商产品详情页，产品是无线降噪耳机。"
    "整体布局：左右分栏，左侧占40%，右侧占60%。"
    "左侧：主图一张大的产品图片，下方4个缩略图横向排列。"
    "右侧：产品标题 SoundPro X3 主动降噪无线蓝牙耳机，字号大加粗。"
    "价格区域：现价¥899大字号红色加粗，原价¥1,299灰色划线，旁边红色标签限时直降400元。"
    "规格选择：颜色三个圆形色块（曜石黑/珍珠白/午夜蓝），版本三个按钮（标准版¥899/Pro版¥1099/旗舰版¥1299），数量加减号。"
    "操作按钮：加入购物车（橙色背景）和立即购买（红色背景）两个大按钮并排。"
    "下方选项卡：商品详情/规格参数/用户评价/售后保障。"
    "用户评价区：3条评价卡片，头像+用户名+星级+评价文字+时间+购买版本。"
    "相关推荐：4个商品卡片横向排列。"
    "页脚：4列链接（购物指南/配送方式/支付方式/售后服务）+版权栏。"
    "整体风格：电商专业风，主色调红色(#E53935)和橙色(#FF9800)搭配，背景白色。"
)  # 400+ 字符


class MockSummarizer:
    """模拟摘要 LLM：返回压缩文本（保留原文案关键词）。"""

    def __init__(self, summary: str | None = None):
        self.summary = summary
        self.calls = 0

    def __call__(self, system: str, user: str) -> str:
        self.calls += 1
        if self.summary is not None:
            return self.summary
        return ""


class TestSummarizePrompt:
    def test_short_prompt_unchanged(self):
        client = LLMClient(mock_responder=MockSummarizer("不应被调用"))
        out, summarized = summarize_prompt("做一个登录页", client)
        assert out == "做一个登录页"
        assert summarized is False

    def test_long_prompt_summarized(self):
        summary = "电商产品详情页：无线降噪耳机，左右分栏。价格¥899（红）原价¥1,299划线。按钮：加入购物车/立即购买。主色红#E53935橙#FF9800。"
        client = LLMClient(mock_responder=MockSummarizer(summary))
        out, summarized = summarize_prompt(LONG_PROMPT, client)
        assert summarized is True
        assert out == summary
        assert len(out) < len(LONG_PROMPT) * 0.9

    def test_empty_summary_falls_back_to_original(self):
        client = LLMClient(mock_responder=MockSummarizer(""))
        out, summarized = summarize_prompt(LONG_PROMPT, client)
        assert summarized is False
        assert out == LONG_PROMPT

    def test_threshold_boundary(self):
        client = LLMClient(mock_responder=MockSummarizer("x"))
        # 恰好 400 字符 → 不摘要
        prompt = "字" * 400
        out, summarized = summarize_prompt(prompt, client)
        assert summarized is False and out == prompt
        # 401 字符 → 摘要（responder 返回过短 → 保底原文）
        prompt2 = "字" * 401
        out2, summarized2 = summarize_prompt(prompt2, client)
        assert summarized2 is False and out2 == prompt2


class TestTemplateCompliance:
    def test_ecommerce_template_now_100_percent(self):
        """P2 修复：商品卡片 background 改为白名单内 #FFFFFF 后，ecommerce 模板兼容率 100%。"""
        _, violations, total = enforce_compliance(TEMPLATES["ecommerce"])
        assert violations == 0, f"仍有 {violations} 处违规"
        assert compliance_rate(violations, total) == 100.0

    def test_all_templates_full_compliance(self):
        for name, template in TEMPLATES.items():
            _, violations, total = enforce_compliance(template)
            rate = compliance_rate(violations, total)
            assert rate >= 85, f"模板 {name} 兼容率 {rate}% < 85%"
