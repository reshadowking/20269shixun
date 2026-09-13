"""AI 角色边界守卫（缺陷 9）：只回答 UI/设计相关问题，无关请求礼貌拒答。

规则（保守放行，避免误杀）：
- 含页面类型词（登录/电商/仪表/表单/列表/文章/落地页等）→ 设计请求
- 或 含设计动词（设计/生成/创建/改成/调大…）+ UI/组件词（按钮/布局/颜色/间距…）→ 设计请求
- 或 组件词（卡片/按钮/标题…）+ 美化效果词（阴影/渐变/圆角…）同时出现 → 设计请求
  （缺口清单 §4.6：「给所有卡片加阴影」这类"裸加+效果"句式曾是最高频的自然说法，
  被动词表误拦在模型门口；定向识别而非把裸"加"入动词表——否则"增加/加载/更加"
  都会放行，削弱角色边界）
其余（"帮我写首诗""1+1 等于几"）→ 拦截并提示角色边界。
"""
import json
from pathlib import Path
from typing import Final

ROOT = Path(__file__).resolve().parent.parent.parent.parent
GUARD_WORDS_FILE = ROOT / "shared" / "design-guard-words.json"
with GUARD_WORDS_FILE.open(encoding="utf-8") as f:
    _GUARD_WORDS: dict[str, list[str]] = json.load(f)

# T10 §2.3：三张基础词表与 componentWords/effectWords 同住 shared/design-guard-words.json
# （单一来源，取前后端并集）——改词只改 JSON 一处，两端判定自动同步。
PAGE_KEYWORDS: Final[list[str]] = _GUARD_WORDS["pageKeywords"]
DESIGN_VERBS: Final[list[str]] = _GUARD_WORDS["designVerbs"]
UI_KEYWORDS: Final[list[str]] = _GUARD_WORDS["uiKeywords"]

# 缺口清单 §4.6 方案 A：组件词/效果词的单一来源是 shared/design-guard-words.json
# （与前端 designGuard.ts 共读同一文件，模式同 beautify-effects.json）——扩充效果库时
# 只改 JSON 一处，两端判定自动同步；契约测试（TestGuardWordsSharedSource）防漂移。
# 直接引用已加载的列表（运行时单一来源；测试通过追加假词可观测"读取"语义）
COMPONENT_WORDS: Final[list[str]] = _GUARD_WORDS["componentWords"]
EFFECT_WORDS: Final[list[str]] = _GUARD_WORDS["effectWords"]


def is_design_request(prompt: str) -> bool:
    """判断是否 UI 设计相关请求（保守放行）。"""
    lowered = prompt.lower()
    if any(k in prompt for k in PAGE_KEYWORDS):
        return True
    has_verb = any(v in prompt for v in DESIGN_VERBS)
    has_ui = any(k in lowered for k in UI_KEYWORDS)
    if has_verb and has_ui:
        return True
    has_component = any(k in prompt for k in COMPONENT_WORDS)
    has_effect = any(k in prompt for k in EFFECT_WORDS)
    return has_component and has_effect


GUARD_REPLY = (
    "我是 AI 设计助手，只负责 UI / 界面设计相关的问题"
    "（页面布局、组件、颜色、间距、圆角等）。"
    "其他类型的问题我无法回答，请描述你想要的设计稿，例如："
    "「设计一个登录页」「把按钮改成红色」。"
)
