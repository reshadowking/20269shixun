"""追问分析引擎（开发清单 Q1-Q5：4 档追问模式 + 智能完整度判断规则）。

模式语义：
- smart（默认）：严格按 Q4 五条规则——类型不明必问；类型明+风格不明问 1 个；都明确/说"随便快速"不追问；最多 2 个。
- concise：只问必要问题（类型不明才问 1 个），其余不问。
- detailed：问得更全——类型不明问类型；风格未明确问风格；都明确再问 1 个内容重点；最多 2 个。
- off：默认不追问；但页面类型缺失时（Q5）仍建议问一次，带"随便选一个"按钮。

纯规则实现（不调 LLM）：确定性强、mock 友好、可进 CI；生成时答案由前端并入 prompt 再走 AI 管线。
"""
from dataclasses import dataclass, field

from .templates import KEYWORD_MAP

FOLLOWUP_MODES = ("smart", "concise", "detailed", "off")

# 规则④：用户表达"快速/随便"意图 → 不追问
SKIP_KEYWORDS = ("随便", "快速", "都行", "你定", "随意", "看着办", "自由发挥", "尽快")

# 风格意图词表：命中任一即视为风格已明确
STYLE_KEYWORDS = (
    "简洁", "极简", "简约", "现代", "科技", "暗色", "深色", "渐变", "商务", "专业",
    "活泼", "温暖", "大气", "高级", "清新", "扁平", "拟物", "赛博", "霓虹", "北欧",
    "日系", "复古", "时尚", "潮流", "可爱", "卡通", "严肃", "正式", "质感", "酷炫",
    "未来感", "玻璃拟态", "毛玻璃", "风格", "色调", "配色", "色系",
)

PAGE_TYPE_OPTIONS = [
    "登录页", "落地页", "电商页", "仪表板", "表单页", "列表页", "个人主页", "文章页", "随便选一个",
]
STYLE_OPTIONS = ["简洁现代", "圆角活泼", "深色科技", "渐变大气", "商务专业", "随便选一个"]
FOCUS_OPTIONS = ["产品介绍", "数据展示", "表单收集", "内容阅读", "随便选一个"]


@dataclass
class Question:
    key: str  # page_type | style | focus
    question: str
    options: list[str] = field(default_factory=list)
    default: str = ""


@dataclass
class QuestionAnalysis:
    questions: list[Question]
    page_type: str | None  # 已明确的模板类型（None = 未明确）
    style_known: bool
    mode: str


def _page_type_of(prompt: str) -> str | None:
    """页面类型是否明确：命中任一模板关键词即明确（与模板匹配同源）。"""
    lowered = prompt.lower()
    for keywords, name in KEYWORD_MAP:
        if any(k.lower() in lowered for k in keywords):
            return name
    return None


def _style_known(prompt: str) -> bool:
    return any(k in prompt for k in STYLE_KEYWORDS)


def analyze_questions(prompt: str, mode: str = "smart") -> QuestionAnalysis:
    """按模式生成追问问题列表（≤2 个，规则⑤：超过用默认值）。"""
    if mode not in FOLLOWUP_MODES:
        mode = "smart"
    page_type = _page_type_of(prompt)
    style_known = _style_known(prompt)

    # 规则④ 优先：用户说"随便/快速"→ 不追问
    if any(k in prompt for k in SKIP_KEYWORDS):
        return QuestionAnalysis([], page_type, style_known, mode)

    questions: list[Question] = []
    if page_type is None:
        # 规则① + Q5：类型不明确 → 必须追问（off 模式下也问，带"随便选一个"）
        questions.append(Question("page_type", "请问是什么类型的页面？", list(PAGE_TYPE_OPTIONS), "落地页"))

    if mode == "detailed":
        if not style_known:
            questions.append(Question("style", "希望是什么风格？", list(STYLE_OPTIONS), "简洁现代"))
        elif not questions:
            # 类型 + 风格都明确：再确认 1 个内容重点（详细模式的差异化追问）
            questions.append(Question("focus", "这个页面最想突出什么内容？", list(FOCUS_OPTIONS), "产品介绍"))
    elif mode == "smart" and not style_known and page_type is not None:
        # 规则②：类型明确但风格没说 → 追问 1 个（风格）
        questions.append(Question("style", "希望是什么风格？", list(STYLE_OPTIONS), "简洁现代"))
    # concise：类型不明已问；类型明确则不追问；off：仅 Q5 的类型问题

    return QuestionAnalysis(questions[:2], page_type, style_known, mode)
