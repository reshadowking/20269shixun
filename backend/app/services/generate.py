"""AI 生成管线（v2.2 §4.1：意图解析 → 模板匹配 → 参数填充+智能文案 → 合规检查）。

30 秒预算：意图解析 2-5s（调用 1）→ 模板匹配 <1s → 参数填充 5-10s（调用 2）→ 合规 <1s。
调用失败/非 JSON/mock 模式 → 返回模板默认稿（断网兜底，v2.2 §1.4）。
"""
import logging
import re
import time
from dataclasses import dataclass, field
from typing import Any

from opentelemetry import trace

from ..config import get_settings
from ..design.validator import SchemaError, validate_design
from .compliance import compliance_rate, enforce_compliance
from .llm import LLMClient, describe_api_error, to_llm_dict
from .templates import KEYWORD_MAP, TEMPLATES, free_default_design

logger = logging.getLogger(__name__)
gen_logger = logging.getLogger("ai.gen")  # 生成链路日志（backend/logs/generate.log）
tracer = trace.get_tracer("ai-native-design-backend")

INTENT_SYSTEM = """你是设计意图解析器。把用户的自然语言设计需求解析为固定 JSON，不要生成布局细节。
输出格式（必须是合法 JSON，不要输出其他内容）：
{"template": "login|landing|ecommerce|dashboard|form|list|profile|article 之一",
 "theme": "default",
 "components": ["用户提到的关键组件，如按钮/卡片/图表"],
 "copy_intent": "文案要点（一句话）",
 "style_intent": "风格要点（配色/圆角/氛围，一句话）",
 "tone": "文案语气（如：活泼营销/专业商务/温暖人文）"}
模板不适配时选最接近的 template。
严格基于当前用户输入判断，忽略示例与任何历史上下文：
数据/统计/报表/仪表 → dashboard；商品/购买/优惠/商城 → ecommerce；
表单/登记/问卷 → form；列表/订单/管理 → list；文章/博客/资讯 → article；
登录/注册 → login；个人/主页/中心 → profile；其余 → landing。"""

FILL_SYSTEM = """你是 AI 设计生成器。基于给定的模板骨架 JSON 与设计令牌，输出一张完整可渲染的 DesignNode 树。
组件白名单（只能使用这 15 种 componentType，禁止新增其他类型）：
button, card, input, select, table, chart, stat-block, navbar, sidebar, avatar, tag, divider, title-text, hero, image
硬约束：
1. 保持模板的节点结构与布局（layout/组件类型），只填充和优化 props 与 style；不要发明新组件类型。
2. 颜色：用户明确指定的品牌色 hex 必须原样使用（如 #FF6B35）；未指定时使用令牌名（primary/secondary/danger/success/background/text-primary/text-secondary/text-light/border）。
   用户要求"橙色/红色/绿色"等主色调时，把主色应用到 CTA 按钮、标题强调、卡片底色等主要视觉区域，不要用默认蓝色。
   颜色优先使用令牌名；用户指定 hex 只用于强调区域，背景/大面积区域用令牌或白，避免自创颜色。
3. 字号 fontSize 用数字；字重 fontWeight 用数字（400/500/600/700）；间距/圆角用数字。
4. 文本内容：用户明确指定的标题、导航菜单项、数值、品牌名等必须【原样使用】，禁止修改、缩写、翻译或自创。
   用户说的"如 XXX"是示例说明，不是要求，应生成不同的合理内容。
5. 商品/列表类内容（如商品卡片）：每个条目必须包含完整信息结构——商品图（image 组件或占位）、商品名、原价（text，划线样式可用 text-decoration）、现价、折扣标签（tag 组件）、加入购物车按钮（button 组件）。多个条目内容必须各不相同。
6. 生成的内容（商品名、文案、模拟数据）每次必须不同，避免与模板默认值重复；
   模板中的商品名（如 Air Run Pro / Flex Trainer 等）只是结构示例，必须替换为全新的名称、价格与折扣文案；
   chart 数据用合理的新数值。
7. chart 组件：根据需求生成合理模拟数据（数组对象，字段与 xKey/yKey 对应）。
8. 输出必须是合法 JSON（DesignNode 树），不要输出任何其他内容。
9. 节点格式（严格遵守）：容器用 {"type":"frame"}；组件必须用 {"type":"component","componentType":"组件类型"}，
   禁止把组件名直接写在 type 字段（例如 {"type":"divider"} 或 {"type":"button"} 都是错的）。
10. JSON 语法（严格遵守）：对象属性之间必须用逗号分隔，最后一个属性后禁止多余逗号；
    输出前检查每个对象闭合。
11. 输出体积（严格遵守）：使用紧凑 JSON——嵌套层级之间允许必要换行，但不要为空行、
    不要大段缩进（如每行 16 空格）、不要重复冗余字段；输出越长越容易在尾部出错。
    目标是整棵树的输出 token 越少越好。"""

# 用户指定色提取：prompt 中的 hex（品牌色不被合规检查器拉回，v2.2 §4.5）
HEX_RE = re.compile(r"#[0-9a-fA-F]{3,8}\b")

# 15 种组件类型（与 FILL_SYSTEM/FREE_SYSTEM 白名单一致）
COMPONENT_TYPE_NAMES = {
    "button", "card", "input", "select", "table", "chart", "stat-block",
    "navbar", "sidebar", "avatar", "tag", "divider", "title-text", "hero", "image",
}

# 样式数值边界（与 shared/design-schema.json 一致；超界自动 clamp，不整树回退）
STYLE_BOUNDS = {
    "fontSize": (8, 96),
    "spacing": (0, 200),
    "padding": (0, 200),
    "gap": (0, 100),
    "radius": (0, 64),
    "fontWeight": (100, 900),
}

# props 字段类型边界（与 shared/design-schema.json 的 props 定义一致）
PROPS_STRING_FIELDS = {
    "text", "label", "placeholder", "variant", "size", "title", "subtitle", "trend",
    "name", "alt", "src", "xKey", "yKey", "fit", "chartType", "color", "content",
    "backgroundImage", "type_",
}
PROPS_NUMBER_FIELDS = {"level": (1, 6)}
PROPS_BOOL_FIELDS = {"disabled"}
PROPS_ARRAY_FIELDS = {"options", "columns", "rows", "items", "links", "data"}
# 对象字段（Schema 要求 object）：模型常误写成字符串（如 action: "立即学习"）→ 转 {"text": ...}
PROPS_OBJECT_FIELDS = {"cta", "action"}

# 枚举字段（与 Schema 一致）：非法值删除（用默认值渲染），不整树回退
STYLE_ENUMS = {
    "layout": {"row", "column", "grid", "free"},
    "align": {"left", "center", "right"},
    "justify": {"flex-start", "center", "flex-end", "space-between"},
    "alignItems": {"flex-start", "center", "flex-end", "stretch"},
    "flexDirection": {"row", "column"},
}
PROPS_ENUMS = {
    "chartType": {"line", "bar", "pie"},
    "fit": {"cover", "contain", "fill"},
    # P14 决策卡收敛后与 schema/组件库/面板四方一致：非法值删除（组件默认值渲染），
    # 避免 LLM 偶发输出 'orange' 这类值导致整树 Schema 校验失败回退模板
    "variant": {"default", "primary", "secondary", "outline", "ghost", "destructive"},
    "size": {"sm", "default", "lg"},
    "type_": {"text", "password", "email", "number"},
}


def _clamp_style(node: dict) -> None:
    """样式数值超界 → clamp 到 Schema 合法范围（如头像圆形 radius:100 → 64）；
    枚举值非法 → 删除字段（如 align:'stretch' 是 alignItems 的值，误写进 align）。"""
    style = node.get("style")
    if not isinstance(style, dict):
        return
    for key, (lo, hi) in STYLE_BOUNDS.items():
        value = style.get(key)
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            style[key] = max(lo, min(hi, round(value)))
            gen_logger.debug("修复 style.%s %s→%s", key, value, style[key])
    for key, allowed in STYLE_ENUMS.items():
        value = style.get(key)
        if value is not None and value not in allowed:
            del style[key]
            gen_logger.debug("修复 style.%s 非法枚举 %s 已删除", key, value)


def _repair_props(node: dict) -> None:
    """props 字段类型修正（如模型把字号写成 props.size: 28，Schema 要求 string）。

    按 Schema 定义：string 字段数字转字符串；number 字段可转则转并 clamp；
    boolean/array 字段类型不对则删除（组件用默认值渲染）。
    """
    props = node.get("props")
    if not isinstance(props, dict):
        return
    for key, value in list(props.items()):
        if key in PROPS_ENUMS:
            # 枚举字段（P14 收敛后含 variant/size/type_）：仅接受合法枚举字符串，其余删除（组件默认渲染）。
            # 必须最先判断——避免数字 28 先被转成字符串 "28" 逃过枚举校验。
            if isinstance(value, str) and value in PROPS_ENUMS[key]:
                continue
            del props[key]
            gen_logger.debug("修复 props.%s 非法枚举 %r 已删除", key, value)
        elif key in PROPS_STRING_FIELDS and not isinstance(value, str):
            props[key] = str(value)
            gen_logger.debug("修复 props.%s %r→%r", key, value, props[key])
        elif key in PROPS_NUMBER_FIELDS:
            lo, hi = PROPS_NUMBER_FIELDS[key]
            if isinstance(value, bool):
                del props[key]
                gen_logger.debug("修复 props.%s 非法类型 %r 已删除", key, value)
            elif isinstance(value, (int, float)):
                props[key] = max(lo, min(hi, round(value)))
                gen_logger.debug("修复 props.%s %r→%r", key, value, props[key])
            elif isinstance(value, str) and value.strip().lstrip("-").isdigit():
                props[key] = max(lo, min(hi, int(value)))
                gen_logger.debug("修复 props.%s %r→%r", key, value, props[key])
            else:
                del props[key]
                gen_logger.debug("修复 props.%s 无法转换 %r 已删除", key, value)
        elif key in PROPS_BOOL_FIELDS and not isinstance(value, bool):
            del props[key]
            gen_logger.debug("修复 props.%s 非布尔 %r 已删除", key, value)
        elif key in PROPS_ARRAY_FIELDS:
            if not isinstance(value, list):
                del props[key]
                gen_logger.debug("修复 props.%s 非数组 %r 已删除", key, value)
            elif key == "options":
                # options 是字符串数组：对象元素提取 label（模型常写成 [{label:...}]）
                fixed_options = []
                for v in value:
                    if isinstance(v, str):
                        fixed_options.append(v)
                    elif isinstance(v, dict) and isinstance(v.get("label"), str):
                        fixed_options.append(v["label"])
                    else:
                        fixed_options.append(str(v))
                if fixed_options != value:
                    props[key] = fixed_options
                    gen_logger.debug("修复 props.%s 元素 → 字符串数组", key)
            else:
                # links/items/columns/rows/data 是对象数组：字符串元素 → {"label": 值}
                fixed_items = [v if isinstance(v, dict) else {"label": str(v)} for v in value]
                if fixed_items != value:
                    props[key] = fixed_items
                    gen_logger.debug("修复 props.%s 元素 → 对象数组", key)
        elif key in PROPS_OBJECT_FIELDS:
            if isinstance(value, str):
                # 模型常把对象字段写成字符串（action: "立即学习"）→ 转 {"text": 值}
                props[key] = {"text": value}
                gen_logger.debug("修复 props.%s 字符串 %r → 对象", key, value)
            elif not isinstance(value, dict):
                del props[key]
                gen_logger.debug("修复 props.%s 非对象 %r 已删除", key, value)


def repair_design(node: dict) -> dict:
    """宽容化修复 LLM 产物的常见格式错误（不认识的节点原样保留，仍非法则回退模板）。

    常见错误：模型把组件名直接写进 type（如 {"type": "divider"}），
    或样式数值超界（如 radius: 100 超出 0-64）。
    这类错误只占整棵树的少数节点，修复后可保留 LLM 的其余成果，避免整棵回退。
    """
    node = dict(node)
    t = node.get("type")
    ct = node.get("componentType")
    if ct is not None and not isinstance(ct, str):
        del node["componentType"]
    if t in COMPONENT_TYPE_NAMES and ct is None:
        node["type"] = "component"
        node["componentType"] = t
    elif ct is not None and t is None:
        node["type"] = "component"
    _clamp_style(node)
    _repair_props(node)
    children = node.get("children")
    if children is not None:
        if not isinstance(children, list):
            node["children"] = []
        else:
            repaired = []
            for i, child in enumerate(children):
                if isinstance(child, dict):
                    if not child.get("id"):
                        # children 元素缺 id（模型把链接/标签对象直接当子节点）→ 派生 id
                        child = dict(child)
                        child["id"] = f"{node.get('id', 'n')}-c{i}"
                        gen_logger.debug("修复 children 元素缺 id → %s", child["id"])
                    child = repair_design(child)
                else:
                    # 字符串等非对象元素 → text 节点（模型把菜单项/标签直接写进 children）
                    child = {"id": f"{node.get('id', 'n')}-c{i}", "type": "text", "props": {"text": str(child)}}
                    gen_logger.debug("修复 children 非对象元素 → text 节点")
                repaired.append(child)
            node["children"] = repaired
    return node

# 自由生成触发词（E3-1：显式指令优先于模板匹配）
FREE_TRIGGER_KEYWORDS = ("自由生成", "不用模板", "不要模板", "自由发挥", "随意发挥")

FREE_SYSTEM = """你是 AI 设计生成器。直接根据用户需求生成一张完整可渲染的 DesignNode 树（不使用任何预置模板）。
组件白名单（只能使用这 15 种 componentType，禁止新增其他类型）：
button, card, input, select, table, chart, stat-block, navbar, sidebar, avatar, tag, divider, title-text, hero, image
硬约束：
1. 页面结构合理：用 frame 组织层级（layout 用 row/column/grid；需要自由摆放时用 free + x/y 坐标），
   典型结构：顶部导航 → 内容区 → 行动点；不要只输出一个扁平容器。
2. 颜色：用户明确指定的品牌色 hex 必须原样使用；未指定时使用令牌名
   （primary/secondary/danger/success/background/text-primary/text-secondary/text-light/border）。
3. 字号 fontSize 用数字；字重 fontWeight 用数字（400/500/600/700）；间距 gap/圆角 radius/padding 用数字。
4. 文本内容：用户明确指定的标题、导航项、品牌名等必须【原样使用】；其余文案贴合场景生成。
5. 商品/列表类内容每个条目必须完整（图/名/原价/现价/折扣标签/加购按钮），多个条目内容各不相同。
6. 生成的内容每次必须不同；chart 数据用合理的新数值。
7. 输出必须是合法 JSON（DesignNode 树），不要输出任何其他内容。
8. 节点格式（严格遵守）：容器用 {"type":"frame"}；组件必须用 {"type":"component","componentType":"组件类型"}，
   禁止把组件名直接写在 type 字段（例如 {"type":"divider"} 或 {"type":"button"} 都是错的）。
9. 输出体积（严格遵守）：使用紧凑 JSON——嵌套层级之间允许必要换行，不要空行、不要大段缩进；
   输出越长越容易在尾部出错，整棵树输出 token 越少越好。"""


def extract_user_colors(prompt: str) -> list[str]:
    return list(dict.fromkeys(HEX_RE.findall(prompt)))


# ---- 长提示词摘要（超长需求先压缩，减小参数填充输入，防超时/输出截断）----
SUMMARY_THRESHOLD = 400  # 字符数：超过则先摘要再进参数填充

# 增量修改（P0-1：基于当前树只改用户指定部分，其他节点保持不变）
INCREMENTAL_SYSTEM = """你是 AI 设计修改器。基于给定的 DesignNode 树（current_design），根据用户要求做【最小修改】。
硬约束：
1. 只修改用户明确要求的节点（文本/颜色/尺寸/位置/间距等），其余所有节点必须【逐字段保持原值】——
   文本、颜色、字号、圆角、布局、顺序、id 一律不变。
2. 用户说"按钮/标题/卡片/图片/输入框"等时，根据内容或位置定位到树中对应节点，只改那一个节点。
3. 改色语义（严格遵守，缺陷 12）：
   - 说"把界面/页面/整个设计/背景 改为 X 色" → 改最外层容器的背景或整体主题色；
   - 说"把按钮/标题/卡片/某个组件 改为 X 色" → 只改该组件的前景色（文字）或背景，禁止改页面背景；
   - 用户已明确"背景不变/保留背景"时，背景必须保持上一轮的值（不得沿用之前误改的色）；
   - 说法含糊（如只说"改为红色"没说目标）时：优先只改前景/强调元素，保持背景不变。
4. 输出修改后的【完整 DesignNode 树】（不是 patch、不是片段），节点 id 与原来一致，结构与原来一致。
4. 组件类型必须用 {"type":"component","componentType":"xxx"}；样式颜色优先令牌名
   （primary/secondary/danger/success/background/text-primary/text-secondary/text-light/border），用户指定 hex 原样。
5. 字号 fontSize 用数字（8-96）；间距 gap/圆角 radius 用数字。
6. 输出必须是合法 JSON（完整 DesignNode 树），不要输出任何其他内容；JSON 语法必须正确（属性间逗号、对象闭合）。"""

SUMMARY_SYSTEM = """你是需求摘要器。把用户的长篇设计需求压缩为简洁的结构化需求描述（200 字以内），供下游生成设计稿。
硬约束：
1. 用户明确指定的【原文案】必须逐字保留：标题、价格、按钮文字、品牌名、评价内容、导航/页脚链接文字等，禁止改写、缩写、翻译。
2. 用户明确指定的颜色（#hex 或"红色/橙色"等）、布局结构（分栏/顺序/对齐/位置）、组件类型（图片/按钮/输入框/选项卡/商品卡片/缩略图）必须保留。
3. 删除解释性、重复性、装饰性文字（如铺垫句、示例说明），合并同类要求。
4. 只输出摘要文本本身，不要任何前缀、解释或编号。"""


def summarize_prompt(prompt: str, client: LLMClient) -> tuple[str, bool]:
    """超长提示词摘要（保底：过短 / 摘要不合理 / 调用失败 → 原样返回）。

    返回 (实际使用的 prompt, 是否走了摘要)。"""
    if len(prompt) <= SUMMARY_THRESHOLD:
        return prompt, False
    try:
        summary = client.chat_text(SUMMARY_SYSTEM, prompt, 0.2).strip()
        if 50 <= len(summary) < len(prompt) * 0.9:
            return summary, True
    except Exception as exc:  # noqa: BLE001 - 摘要失败不阻塞主流程
        logger.warning("长提示词摘要失败，使用原文: %s", str(exc)[:80])
    return prompt, False


def match_template_scores(prompt: str) -> dict[str, float]:
    """8 模板关键词置信度（E3-1）：命中 1 个关键词 = 0.6，命中 ≥2 个 = 1.0，未命中 = 0。
    阈值 0.5：单个强关键词足以选中模板，避免泛词把模糊需求错误归到模板。
    """
    lowered = prompt.lower()
    scores: dict[str, float] = {}
    for keywords, name in KEYWORD_MAP:
        hits = sum(1 for k in keywords if k.lower() in lowered)
        scores[name] = 1.0 if hits >= 2 else (0.6 if hits == 1 else 0.0)
    return scores


def _select_template(prompt: str, intent: dict[str, Any] | None) -> str:
    """模板选择（E3-1）：显式自由指令 > LLM 明确模板 > 关键词置信度 ≥0.5 > 自由生成。"""
    if any(k in prompt for k in FREE_TRIGGER_KEYWORDS):
        return "free"
    llm_template = (intent or {}).get("template")
    if llm_template in TEMPLATES:
        return llm_template
    scores = match_template_scores(prompt)
    best = max(scores, key=scores.get)
    return best if scores[best] >= 0.5 else "free"


@dataclass
class GenerateResult:
    design: dict[str, Any]
    template: str
    compliance: float
    violations: int = 0
    style_attrs: int = 0
    time_ms: dict[str, float] = field(default_factory=dict)
    fallback: bool = False  # 是否走了兜底（mock/失败）
    error: str = ""  # LLM 失败原因（限流/超时等），供前端展示与排查


def generate_design(prompt: str, client: LLMClient | None = None, current_design: dict[str, Any] | None = None) -> GenerateResult:
    """生成设计稿。current_design 非空时走【增量修改】模式（P0-1）：
    基于当前树只改用户指定部分，其他节点保持不变；失败兜底返回原树。
    """
    settings = get_settings()
    client = client or LLMClient()
    times: dict[str, float] = {}
    fallback = False
    error = ""
    is_edit = current_design is not None
    start_all = time.perf_counter()
    gen_logger.info("生成开始 prompt=%d字符 mode=%s", len(prompt), "edit" if is_edit else "full")

    # ---- 调用 1：意图解析（增量修改跳过——基于当前树修改，无需模板意图）----
    t0 = time.perf_counter()
    intent: dict[str, Any] | None = None
    if not is_edit:
        with tracer.start_as_current_span("intent_parse"):
            try:
                intent = client.chat_json(INTENT_SYSTEM, prompt, settings.llm_temperature_parse)
            except Exception as exc:  # noqa: BLE001 - 网络/限流等异常 → 兜底并记录原因
                error = f"意图解析调用失败：{type(exc).__name__} {str(exc)[:120]}"
                intent = None
            if intent is None and not error:
                # 意图解析失败：仅记录原因，不视为降级（模板选择仍可走关键词/自由生成，填充由 LLM 完成）
                error = "意图解析未返回有效 JSON（模型限流或超时）"
    times["intent_parse"] = time.perf_counter() - t0
    gen_logger.info("意图解析 ok=%s 耗时=%.2fs error=%s", intent is not None, times["intent_parse"], error or "-")

    # ---- 模板选择（增量修改固定 template=edit，不参与模板/自由生成判断）----
    t0 = time.perf_counter()
    with tracer.start_as_current_span("template_match"):
        template_name = "edit" if is_edit else _select_template(prompt, intent)
        if intent is not None:
            intent["template"] = template_name
    times["template_match"] = time.perf_counter() - t0

    # ---- 长提示词摘要（超长需求先压缩，减小 FILL 输入，防超时/输出截断）----
    t0 = time.perf_counter()
    fill_prompt = prompt
    summarized = False
    with tracer.start_as_current_span("prompt_summary"):
        if len(prompt) > SUMMARY_THRESHOLD and not client.is_mock:
            fill_prompt, summarized = summarize_prompt(prompt, client)
    times["prompt_summary"] = time.perf_counter() - t0
    gen_logger.info("模板=%s 摘要=%s 摘要后%d字符", template_name, summarized, len(fill_prompt))

    # ---- 调用 2：参数填充 + 智能文案（增量修改用 INCREMENTAL_SYSTEM，基于当前树）----
    t0 = time.perf_counter()
    with tracer.start_as_current_span("param_fill"):
        if is_edit:
            default = current_design  # 增量失败兜底：返回原树（画布不变，不丢用户调整）
            user_payload = {"user_request": fill_prompt, "current_design": current_design}
            fill_system = INCREMENTAL_SYSTEM
        else:
            is_free = template_name == "free"
            default = free_default_design(prompt) if is_free else TEMPLATES.get(template_name, TEMPLATES["landing"])
            user_payload = {"user_request": fill_prompt, "intent": intent}
            if not is_free:
                user_payload["template_skeleton"] = default
            fill_system = FREE_SYSTEM if is_free else FILL_SYSTEM
        try:
            filled = client.chat_json(fill_system, to_llm_dict(user_payload), settings.llm_temperature_fill)
        except Exception as exc:  # noqa: BLE001
            error = f"参数填充调用失败：{describe_api_error(exc)}"
            filled = None
        if filled is None or not isinstance(filled, dict):
            fallback = True
            if not error:
                error = "参数填充未返回有效 JSON（模型限流或超时）"
            filled = default
        else:
            # LLM 产物先宽容修复常见格式错误（type 误写/数值超界/枚举非法/props 类型），再过 Schema
            filled = repair_design(filled)
            try:
                validate_design(filled)
            except SchemaError as exc:
                logger.warning("LLM 产物 Schema 校验失败，回退%s: %s", "原设计" if is_edit else ("自由生成兜底稿" if is_free else "模板"), exc.errors[:2])
                fallback = True
                error = f"生成结果未通过 Schema 校验（{exc.errors[0][:80]}）"
                filled = default
    times["param_fill"] = time.perf_counter() - t0
    gen_logger.info("参数填充 ok=%s 耗时=%.2fs error=%s", filled is not None and not fallback, times["param_fill"], error or "-")

    # ---- 合规检查（用户指定色不拉回，v2.2 §4.5）----
    t0 = time.perf_counter()
    with tracer.start_as_current_span("compliance_check"):
        user_colors = extract_user_colors(prompt)
        design, violations, total = enforce_compliance(filled, allowed_extra=user_colors)
    times["compliance_check"] = time.perf_counter() - t0

    # Mock 模式（未配 Key 的演示/测试）：模板稿即"模型输出"，不标记降级；
    # 真实 Key 模式下 LLM 失败才 fallback=True（前端显示失败卡片）
    if client.is_mock and not is_edit:
        fallback = False
        error = ""

    rate = compliance_rate(violations, total)
    times["total"] = time.perf_counter() - start_all
    gen_logger.info(
        "生成结束 template=%s fallback=%s 兼容率=%.1f%% 总耗时=%.2fs 阶段=%s",
        template_name, fallback, rate, times["total"],
        {k: round(v, 2) for k, v in times.items()},
    )

    return GenerateResult(
        design=design,
        template=template_name,
        compliance=rate,
        violations=violations,
        style_attrs=total,
        time_ms=times,
        fallback=fallback,
        error=error,
    )
