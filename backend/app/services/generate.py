"""AI 生成管线（v2.2 §4.1：意图解析 → 模板匹配 → 参数填充+智能文案 → 合规检查）。

30 秒预算：意图解析 2-5s（调用 1）→ 模板匹配 <1s → 参数填充 5-10s（调用 2）→ 合规 <1s。
调用失败/非 JSON/mock 模式 → 返回模板默认稿（断网兜底，v2.2 §1.4）。
"""
import copy
import json
import logging
import re
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

from opentelemetry import trace

from ..config import get_settings
from ..design.validator import SchemaError, validate_design
from . import ai_breaker
from .ai_gateway import GenerationDeadline
from .beautify import preset_value, vocabulary_text
from .compliance import compliance_rate, enforce_compliance
from .edit_guard import structure_loss_reason
from .llm import LLMClient, describe_api_error, to_llm_dict
from .ops import OP_TYPES, apply_ops
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
组件白名单（只能使用这 18 种 componentType，禁止新增其他类型）：
button, card, input, select, table, chart, stat-block, navbar, sidebar, avatar, tag, divider, title-text, hero, image, icon, switch, tabs
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
    目标是整棵树的输出 token 越少越好。
12. 需求里出现分页、弹窗等组件白名单外的元素：禁止自创 componentType
    （如 pagination/dialog，会导致整稿被拒）；用最接近的合法组件表达——
    分页→一排 button、弹窗→frame + 按钮。"""

# 用户指定色提取：prompt 中的 hex（品牌色不被合规检查器拉回，v2.2 §4.5）
HEX_RE = re.compile(r"#[0-9a-fA-F]{3,8}\b")

# 18 种组件类型（与 FILL_SYSTEM/FREE_SYSTEM 白名单一致）
COMPONENT_TYPE_NAMES = {
    "button", "card", "input", "select", "table", "chart", "stat-block",
    "navbar", "sidebar", "avatar", "tag", "divider", "title-text", "hero", "image",
    "icon", "switch", "tabs",
}

# ---- T9：图标库单一来源（shared/icon-library.json，照 beautify-effects.json 的加载方式）----
# 消费方：① 提示词运行期注入（icon_prompt_section，禁止手抄进 FILL/FREE/INCREMENTAL 正文）；
# ② repair_design 对 icon 未知名记 gen_logger（渲染层兜底，不降级）。前端从同一 JSON import。
ROOT = Path(__file__).resolve().parent.parent.parent.parent
ICON_LIBRARY_FILE = ROOT / "shared" / "icon-library.json"
with ICON_LIBRARY_FILE.open(encoding="utf-8") as _f:
    ICON_LIBRARY: dict[str, Any] = json.load(_f)


def icon_names() -> frozenset[str]:
    """可用图标名集合（每次从 ICON_LIBRARY 现算——单一来源防漂移测试依赖可观测变化）。"""
    return frozenset(i["name"] for i in ICON_LIBRARY["icons"])


def icon_names_text() -> str:
    """运行期从 shared/icon-library.json 现算可用图标名清单（照 beautify.vocabulary_text 模式）。"""
    return "、".join(i["name"] for i in ICON_LIBRARY["icons"])


def icon_prompt_section() -> str:
    """三段 system 共用的 icon 提示词段：注入可用图标名（模型逐字取用，清单外渲染兜底）。"""
    return (
        "\n\n## 可用图标（icon 组件的 props.name 只能从中逐字选）\n"
        + icon_names_text()
        + "\n不在上列的名字会被渲染为兜底占位（不会导致整稿被拒），所以禁止编造图标名。"
    )


# ---- T18：组件字段契约（shared/component-library.json，唯一来源，禁止手抄进提示词正文）----
COMPONENT_LIBRARY_FILE = ROOT / "shared" / "component-library.json"
with COMPONENT_LIBRARY_FILE.open(encoding="utf-8") as _cf:
    COMPONENT_LIBRARY: dict[str, Any] = json.load(_cf)

_SHAPE_PARENS_RE = re.compile(r"\[(.*?)\]")


def component_prop_names(component_type: str) -> frozenset[str]:
    """该组件在组件库中**声明**的 props 字段名（每次现算——防漂移测试依赖可观测变化）。"""
    for spec in COMPONENT_LIBRARY["components"]:
        if spec.get("type") == component_type:
            return frozenset((spec.get("props") or {}).keys())
    return frozenset()


def _object_keys(default: Any) -> list[str]:
    """从默认值里取对象字段名（数组取首元素）。"""
    sample = default[0] if isinstance(default, list) and default else default
    return list(sample.keys()) if isinstance(sample, dict) else []


def _shape_of(spec: dict[str, Any]) -> str:
    """字段的结构提示（只有结构性字段才带 = 后缀；标量只留字段名）。"""
    kind = spec.get("type")
    if kind == "array":
        if spec.get("itemType") == "object":
            # 优先用组件库自带的形状说明（如"行数据 [{key: value}]"），空默认值也能给出结构
            matched = _SHAPE_PARENS_RE.search(str(spec.get("description") or ""))
            if matched and matched.group(1).strip():
                return "=[" + re.sub(r"\s+", "", matched.group(1)) + "]"
            keys = _object_keys(spec.get("default"))
            return "=[{" + ",".join(keys) + "}]" if keys else "=[{…}]"
        return "=[字符串]"
    if kind == "object":
        keys = _object_keys(spec.get("default"))
        return "={" + ",".join(keys) + "}" if keys else "={…}"
    enums = spec.get("enum")
    if enums:
        return "=" + "|".join(str(e) for e in enums)
    return ""


# 唯一一个 few-shot 正例（只示意字段结构，内容仍由需求决定；字段名全部来自组件库）
COMPONENT_FEW_SHOT = (
    "\n示例（只示意字段结构，内容按需求生成）："
    '\n{"id":"s1","type":"component","componentType":"stat-block","props":{"label":"本月营收","value":"¥128,400","trend":"↑ 12.6%"}}'
    '\n{"id":"t1","type":"component","componentType":"table","props":{"columns":[{"key":"name","title":"商品"},{"key":"sales","title":"销量"}],"rows":[{"name":"轻量跑鞋","sales":1280}]}}'
    '\n{"id":"c1","type":"component","componentType":"chart","props":{"chartType":"bar","title":"近 6 月销量","xKey":"month","yKey":"sales","data":[{"month":"4月","sales":820}]}}'
)


def component_contract_section() -> str:
    """运行期从 shared/component-library.json 现算的"组件字段契约"段（照 icon_prompt_section 模式）。

    只注入 props 的字段名/结构/枚举——**不注入 default_style**（其中的 `background: "card"`
    这类值不是令牌，注进去会把错误写法教给模型；口径修正见 T19）。
    """
    lines = ["\n\n## 可用组件与字段（只能用这里声明的字段名；数组/对象必须给出结构）"]
    for spec in COMPONENT_LIBRARY["components"]:
        props = spec.get("props") or {}
        fields = "；".join(f"{name}{_shape_of(value)}" for name, value in props.items())
        name = spec.get("name") or ""
        lines.append(f"- {spec['type']} {name}：{fields}" if fields else f"- {spec['type']} {name}：无字段")
    lines.append("字段名写错不会报错，但组件会回退到默认值渲染（等于内容丢失）。")
    return "\n".join(lines) + COMPONENT_FEW_SHOT


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
PROPS_BOOL_FIELDS = {"disabled", "checked"}
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

    # T18：契约外字段只记日志、不改行为——"字段名写错 → 组件用默认值渲染"是静默失败，
    # 这条日志是后续"契约命中率"指标的原料（校验口径见 component_prop_names）。
    component_type = node.get("componentType")
    if node.get("type") == "component" and isinstance(component_type, str):
        declared = component_prop_names(component_type)
        if declared:
            for key in props:
                if key not in declared:
                    gen_logger.warning("props 契约外字段：%s.%s（渲染层忽略，组件回退默认值）", component_type, key)


# T8：已知节点类型（schema type 枚举）与节点级键白名单——降级/裁剪的判定依据
KNOWN_NODE_TYPES = frozenset({"frame", "text", "rect", "component", "group"})
NODE_KEYS = frozenset({"id", "type", "componentType", "props", "style", "x", "y", "hidden", "children"})


def _salvage_text_child(node: dict) -> dict | None:
    """降级前抢救可见文本：props.text/label/name 的第一个非空字符串 → text 子节点。"""
    props = node.get("props")
    if not isinstance(props, dict):
        return None
    for key in ("text", "label", "name"):
        value = props.get(key)
        if isinstance(value, str) and value.strip():
            return {"id": f"{node.get('id', 'n')}-salvaged", "type": "text", "props": {"text": value}}
    return None


def _degrade_to_frame(node: dict, reason: str, degraded: list[str] | None) -> None:
    """T8：未知组件/未知节点类型降级为 frame——保留 id/style/x/y/hidden/children；
    可见文本（props.text/label/name）抢救为 text 子节点追加末尾，其余 props 删除
    （避免把未知组件的语义塞进 frame）。每次降级写生成日志（评测脚本消费生成日志）。"""
    salvaged = _salvage_text_child(node)
    node["type"] = "frame"
    node.pop("componentType", None)
    node.pop("props", None)
    children = node.get("children")
    if salvaged is not None:
        if not isinstance(children, list):
            children = []
        children.append(salvaged)
        node["children"] = children
    if degraded is not None:
        degraded.append(f"{reason}@{node.get('id', '?')}")
    gen_logger.info("未知节点降级为 frame：%s（id=%s，可见文本%s）", reason, node.get("id"), "已抢救" if salvaged else "无")


def repair_design(node: dict, degraded: list[str] | None = None) -> dict:
    """宽容化修复 LLM 产物的常见格式错误（T8：未知组件/未知类型降级 frame、未知键裁剪，
    不再原样放行拖垮整棵树；仍无法修复的形态交由 Schema 校验回退兜底）。

    修复范围：组件名误写进 type（如 {"type": "divider"}）转正；样式数值超界 clamp；
    未知 componentType（如自创 "icon"）与裸未知 type（如 "tabs"）降级 frame；
    节点级未知键（如 "content"，Additional properties 报错来源）裁剪。
    这类错误只占整棵树的少数节点，修复后可保留 LLM 的其余成果，避免整棵回退。

    degraded：可选降级清单累积器（generate_design 传入以向 API 外显降级明细，
    形如 ["icon@节点id"]）；直接调用方（测试等）不传则不收集。
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
    # T8：先转正再判合法性（{"type":"button"} 已在上面转成合法组件，不会被误伤）。
    # componentType 缺失的 component 节点 Schema 本就合法，不在降级之列。
    if node.get("type") == "component" and isinstance(node.get("componentType"), str) and node["componentType"] not in COMPONENT_TYPE_NAMES:
        _degrade_to_frame(node, node["componentType"], degraded)
    elif node.get("type") not in KNOWN_NODE_TYPES:
        _degrade_to_frame(node, str(node.get("type")), degraded)
    # T9：icon 合法化后不再降级；未知名 Schema 不拒（渲染层兜底占位），这里只记日志便于排查
    if node.get("type") == "component" and node.get("componentType") == "icon":
        props = node.get("props")
        name = props.get("name") if isinstance(props, dict) else None
        if isinstance(name, str) and name and name not in icon_names():
            gen_logger.warning("icon 组件未知图标名 %r（id=%s）→ 渲染层将兜底为 help-circle", name, node.get("id"))
    # T8：节点级未知键裁剪（"Additional properties are not allowed" 历史报错的来源）
    for key in [k for k in node if k not in NODE_KEYS]:
        node.pop(key)
        gen_logger.debug("裁剪节点级未知键 %s（id=%s）", key, node.get("id"))
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
                    child = repair_design(child, degraded)
                else:
                    # 字符串等非对象元素 → text 节点（模型把菜单项/标签直接写进 children）
                    child = {"id": f"{node.get('id', 'n')}-c{i}", "type": "text", "props": {"text": str(child)}}
                    gen_logger.debug("修复 children 非对象元素 → text 节点")
                repaired.append(child)
            node["children"] = repaired
    return node


# ---- T17：LLM 输出解包与根节点抢救 ----
# 模型常把整棵树包一层（{"design": {...}}）或漏掉根 id，旧行为是直接判 Schema 失败 → 整稿回退模板
# （generate.log 全量统计：76 次 Schema 失败的原因全部是 "<root>: 'id' is a required property"）。
_WRAPPER_KEYS = ("design", "design_node", "root", "tree", "result", "data", "page", "output")


def _looks_like_design(node: Any) -> bool:
    """设计节点形状：dict + 字符串 id + 已知 type（含"组件名误写进 type"，交由 repair 转正）。"""
    if not isinstance(node, dict) or not isinstance(node.get("id"), str):
        return False
    node_type = node.get("type")
    return node_type in KNOWN_NODE_TYPES or node_type in COMPONENT_TYPE_NAMES


def unwrap_design(payload: Any) -> tuple[dict[str, Any] | None, str]:
    """把 LLM 输出还原成 DesignNode 根；返回 (根节点 | None, 命中来源说明)。

    判定顺序（命中即返回，全部限定"设计节点形状"，不做"抓第一个带 id 的 dict"这种宽松兜底）：
    ① 顶层即设计节点 → "root"；
    ② 已知包裹键下是设计节点 → 键名；
    ③ 包裹键再下探一层（{"result": {"design": …}}）→ "键.键"；
    ④ 顶层是设计节点形状但缺 id → 补 id="root"；
    ⑤ 其余 → (None, "")，交给既有回退链路（不许把任意 JSON 硬造成设计稿）。
    """
    if _looks_like_design(payload):
        return payload, "root"
    if isinstance(payload, dict):
        for key in _WRAPPER_KEYS:
            value = payload.get(key)
            if _looks_like_design(value):
                return value, key
        for key in _WRAPPER_KEYS:  # 只下探这一层（再深容易误抓，见 test_unwrap.py 的深度用例）
            value = payload.get(key)
            if not isinstance(value, dict):
                continue
            for inner_key in _WRAPPER_KEYS:
                inner = value.get(inner_key)
                if _looks_like_design(inner):
                    return inner, f"{key}.{inner_key}"
        node_type = payload.get("type")
        if node_type in KNOWN_NODE_TYPES or node_type in COMPONENT_TYPE_NAMES:
            rescued = dict(payload)
            rescued["id"] = "root"
            return rescued, "补根 id"
    return None, ""


# 自由生成触发词（E3-1：显式指令优先于模板匹配）
FREE_TRIGGER_KEYWORDS = ("自由生成", "不用模板", "不要模板", "自由发挥", "随意发挥")

FREE_SYSTEM = """你是 AI 设计生成器。直接根据用户需求生成一张完整可渲染的 DesignNode 树（不使用任何预置模板）。
组件白名单（只能使用这 18 种 componentType，禁止新增其他类型）：
button, card, input, select, table, chart, stat-block, navbar, sidebar, avatar, tag, divider, title-text, hero, image, icon, switch, tabs
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
   输出越长越容易在尾部出错，整棵树输出 token 越少越好。
10. 需求里出现分页、弹窗等组件白名单外的元素：禁止自创 componentType
    （如 pagination/dialog，会导致整稿被拒）；用最接近的合法组件表达——
    分页→一排 button、弹窗→frame + 按钮。"""


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
6. 输出必须是合法 JSON（完整 DesignNode 树），不要输出任何其他内容；JSON 语法必须正确（属性间逗号、对象闭合）。
7. 需求里出现分页、弹窗等组件白名单外的元素：禁止自创 componentType
   （如 pagination/dialog，会导致整稿被拒）；用最接近的合法组件表达——
   分页→一排 button、弹窗→frame + 按钮。
8. 若用户要求与界面设计无关（例如写诗、算术、闲聊），保持 current_design 原样不变，不要为了
   "完成指令"去改动任何节点。"""

# T4 批2：锁定阶段的额外约束段（仅 locked=True 时追加到增量提示词末尾）
LOCKED_STAGE_SECTION = """

## 版面锁定阶段（locked=true 时生效）
1. 只允许施加/移除上列预置效果，禁止改动布局、模块顺序、结构、文案与尺寸；
2. 效果值必须与预置值逐字一致；
3. 用户说"整个页面/所有卡片/全部模块"时，对全部符合语义的节点施加效果。"""


# T24：会话历史的使用规则（三段 system 共用；history 为空时该段不产生任何行为影响）
HISTORY_USAGE_SECTION = """

## 对话上下文使用规则（有 history 时生效）
1. history 里是此前轮次的需求与结果，仅作背景；以本次 user_request 为准；
2. 若历史与本轮要求冲突，按本轮执行，并且只改必要节点；
3. 历史中出现过的文案/数值默认保持不变，除非本轮明确要求修改。"""


def ops_prompt_section() -> str:
    """T23：op 白名单与输出形态（运行期由 `ops.OP_TYPES` 生成，禁止手抄）。"""
    lines = [
        "\n\n## 修改指令的输出形态（本版起以本节为准）",
        '只输出 {"ops":[…]} 操作列表——不要再输出完整 DesignNode 树（旧约束"输出完整树"自本版作废）。',
        "可用 op（字段名逐字使用）：",
    ]
    for name, fields in OP_TYPES.items():
        lines.append(f"- {name}：{'、'.join(fields)}")
    lines.append(
        '示例：把购买按钮改成红色并放大 → {"ops":[{"op":"set_style","id":"buy","key":"color","value":"danger"},'
        '{"op":"set_style","id":"buy","key":"width","value":200},{"op":"set_style","id":"buy","key":"height","value":48}]}'
    )
    lines.append(
        "约束：节点 id 必须逐字取自 current_design；props 字段名必须来自组件库契约；"
        '删除节点只能用 remove 显式声明；无改动时返回空数组 {"ops":[]}。'
    )
    return "\n".join(lines)


def incremental_system(locked: bool = False) -> str:
    """组装增量修改 system 提示词（T4 批2）：既有约束 + 效果词典 + 图标清单 +（locked 时）锁定约束段。

    - INCREMENTAL_SYSTEM 既有约束文本逐字保留（多处测试断言依赖），词典为追加式拼装；
    - 词典由 shared/beautify-effects.json 运行时生成（beautify.vocabulary_text），
      未锁定时也注入——让模型始终优先用预置值，降低自由 CSS 进树的概率；
    - 图标清单由 shared/icon-library.json 运行时注入（T9，icon_prompt_section）；
    - ⚠️ locked 不是安全开关，只影响提示词措辞：安全判定由服务端闸门
      （apply_locked_edit / design_locks，按会话查表）负责。客户端谎报
      locked=false 的后果只是提示词缺少锁定约束段，模型可能产出越权改动，
      闸门仍会拒绝（画布原样）——体验变差，但没有安全漏洞。
    """
    text = (
        INCREMENTAL_SYSTEM
        + "\n\n## 可用美化效果（只能从中选，禁止自创 CSS 值）\n"
        + vocabulary_text()
        + icon_prompt_section()
        + component_contract_section()
        + (ops_prompt_section() if get_settings().prompt_ops_enabled else "")
        + HISTORY_USAGE_SECTION
    )
    if locked:
        text += LOCKED_STAGE_SECTION
    return text


def fill_system_text() -> str:
    """FILL_SYSTEM + 运行期注入段（图标 T9 + 组件字段契约 T18 + 对话上下文规则 T24）。"""
    return FILL_SYSTEM + icon_prompt_section() + component_contract_section() + HISTORY_USAGE_SECTION


def free_system_text() -> str:
    """FREE_SYSTEM + 运行期注入段（图标 T9 + 组件字段契约 T18 + 对话上下文规则 T24）。"""
    return FREE_SYSTEM + icon_prompt_section() + component_contract_section() + HISTORY_USAGE_SECTION

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
        summary = client.chat_text(SUMMARY_SYSTEM, prompt, 0.2, kind="summary").strip()
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
    mock: bool = False  # 是否演示模式产出（未配置模型 Key：模板稿即"演示稿"，须与模型产物区分）
    error: str = ""  # LLM 失败原因（限流/超时等），供前端展示与排查
    # B2-2：逐项合规拉回明细（node_id/field/original/corrected），供逐项报告 UI
    violations_detail: list = field(default_factory=list)
    # T8：本轮降级明细（["icon@节点id"]，无降级为空）——前端聊天面板消费（T8 收尾）
    degraded: list[str] = field(default_factory=list)
    # T21：本次生成的模型调用记录（由路由层落库到 ai_calls；不含用户文本）
    ai_calls: list[dict] = field(default_factory=list)
    # T23：本轮 ops 落地的受影响节点 id（空表示走的是整树兼容路径）
    ops_applied: list[str] = field(default_factory=list)


# ---- T4 前置：mock 模式增量修改（确定性关键词规则，无 LLM）----

# mock 文案改写的固定新值（E2E/pytest 断言依赖其确定性）
MOCK_EDIT_TEXT = "已按你的要求修改文案（演示模式）"

# prompt 关键词 → (效果 key, 预置值 label)。值经 preset_value 运行时取自
# shared/beautify-effects.json 单一来源，禁止在此写死效果值（防第二份真相漂移）。
_MOCK_EDIT_EFFECTS: list[tuple[tuple[str, ...], str, str]] = [
    (("阴影", "投影"), "shadow", "轻"),
    (("渐变", "背景"), "backgroundImage", "品牌渐变"),
    (("圆角",), "radius", "大圆角"),
    (("动效", "动画"), "animation", "淡入"),
]
_MOCK_EDIT_TEXT_KEYWORDS = ("文案", "文字", "标题", "改成")


def _mock_first_node(tree: dict, pred) -> dict | None:
    """前序遍历找第一个满足条件的节点。"""
    if pred(tree):
        return tree
    for child in tree.get("children") or []:
        hit = _mock_first_node(child, pred)
        if hit is not None:
            return hit
    return None


def _mock_apply_style(tree: dict, key: str, value: Any) -> dict:
    """把效果写到第一个 component 节点（无则根节点）；不增删/重排/改父级。"""
    node = _mock_first_node(tree, lambda n: n.get("type") == "component") or tree
    node.setdefault("style", {})[key] = value
    return tree


def mock_edited_design(prompt: str, tree: dict[str, Any]) -> dict[str, Any]:
    """mock 模式增量修改：按关键词规则产出确定性改写树（纯规则、无 LLM）。

    规则顺序（命中即返回）：效果关键词（阴影/渐变/圆角/动效）→ 文案改写
    （改第一个 type=text 节点的 props.text）→ 默认施加"极轻"阴影（无害效果）。
    硬约束：绝不产生结构变更（不增删/重排/改父级）；效果值一律经
    preset_value 取自 beautify-effects.json（运行时单一来源）。
    """
    new_tree = copy.deepcopy(tree)
    for keywords, key, label in _MOCK_EDIT_EFFECTS:
        if any(k in prompt for k in keywords):
            value = preset_value(key, label)
            if value is not None:
                return _mock_apply_style(new_tree, key, value)
    if any(k in prompt for k in _MOCK_EDIT_TEXT_KEYWORDS):
        node = _mock_first_node(new_tree, lambda n: n.get("type") == "text")
        if node is not None:
            node.setdefault("props", {})["text"] = MOCK_EDIT_TEXT
            return new_tree
    gentle = preset_value("shadow", "极轻")
    if gentle is not None:
        return _mock_apply_style(new_tree, "shadow", gentle)
    return new_tree


def generate_design(
    prompt: str,
    client: LLMClient | None = None,
    current_design: dict[str, Any] | None = None,
    locked: bool = False,
    history: list[dict] | None = None,
    deadline: GenerationDeadline | None = None,
) -> GenerateResult:
    """生成设计稿。current_design 非空时走【增量修改】模式（P0-1）：
    基于当前树只改用户指定部分，其他节点保持不变；失败兜底返回原树。

    locked（T4 批2）只影响增量提示词措辞（是否注入锁定约束段），不参与任何
    安全判定——锁定与否的权威是服务端闸门按 design_locks 查表的结果。

    history（T24）：会话最近若干轮（[{"role","content"}]），仅作背景，
    **以本次 user_request 为准**；为空时行为与改造前逐字相同。

    deadline（T20）：整条链路的时间预算；每次发起真实调用前检查剩余量，
    不足以再跑一次时直接走兜底（不再发请求、不再重试/切备用模型）。mock 模式不受其约束。
    """
    settings = get_settings()
    client = client or LLMClient()
    times: dict[str, float] = {}
    fallback = False
    error = ""
    is_edit = current_design is not None
    degraded: list[str] = []  # T8：本轮降级明细（["icon@节点id"]），随结果外显
    start_all = time.perf_counter()
    gen_logger.info("生成开始 prompt=%d字符 mode=%s", len(prompt), "edit" if is_edit else "full")

    # T22：熔断打开时不再调用模型（返回 200 + 模板/原树兜底，而不是 5xx——保"画布可用"）
    circuit_open = not client.is_mock and ai_breaker.is_open()
    if circuit_open:
        gen_logger.warning("熔断打开（state=%s）：跳过模型调用，直接兜底", ai_breaker.state())

    min_call_budget = float(settings.llm_min_call_budget_seconds)

    def budget_short() -> bool:
        """T20：剩余预算不足以再发起一次真实调用（含重试/切备用）时为真。"""
        return deadline is not None and deadline.remaining() < min_call_budget

    # ---- 调用 1：意图解析（增量修改跳过——基于当前树修改，无需模板意图）----
    t0 = time.perf_counter()
    intent: dict[str, Any] | None = None
    if not is_edit:
        if circuit_open or budget_short():
            gen_logger.warning("剩余时间预算不足，跳过意图解析（按关键词选模板）")
        else:
            with tracer.start_as_current_span("intent_parse"):
                try:
                    intent = client.chat_json(
                        INTENT_SYSTEM,
                        prompt,
                        settings.llm_temperature_parse,
                        history=history,
                        deadline=deadline,
                        kind="intent",
                    )
                except Exception as exc:  # noqa: BLE001 - 网络/限流等异常 → 兜底并记录原因
                    error = f"意图解析调用失败：{describe_api_error(exc)}"
                    intent = None
                if intent is None and not error:
                    # 意图解析失败：仅记录原因，不视为降级（模板选择仍可走关键词/自由生成，填充由 LLM 完成）
                    error = f"意图解析未返回合法 JSON：{client.last_json_error[:120]}"
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
        # T24：编辑模式禁用摘要——"你原话怎么说的"必须原样进模型（首轮生成仍按阈值压缩）
        if (
            len(prompt) > SUMMARY_THRESHOLD
            and not client.is_mock
            and not is_edit
            and not circuit_open
            and not budget_short()
        ):
            fill_prompt, summarized = summarize_prompt(prompt, client)
    times["prompt_summary"] = time.perf_counter() - t0
    gen_logger.info("模板=%s 摘要=%s 摘要后%d字符", template_name, summarized, len(fill_prompt))

    # ---- 调用 2：参数填充 + 智能文案（增量修改用 INCREMENTAL_SYSTEM，基于当前树）----
    t0 = time.perf_counter()
    with tracer.start_as_current_span("param_fill"):
        if is_edit:
            default = current_design  # 增量失败兜底：返回原树（画布不变，不丢用户调整）
            user_payload = {"user_request": fill_prompt, "current_design": current_design, "history": history or []}
            fill_system = incremental_system(locked)
        else:
            is_free = template_name == "free"
            default = free_default_design(prompt) if is_free else TEMPLATES.get(template_name, TEMPLATES["landing"])
            user_payload = {"user_request": fill_prompt, "intent": intent, "history": history or []}
            if not is_free:
                user_payload["template_skeleton"] = default
            fill_system = free_system_text() if is_free else fill_system_text()
        if circuit_open:
            fallback = True
            error = "AI 服务暂时不可用（已自动降级）"
            client.note_skipped("fill", "circuit_open")
            filled = None
        elif not client.is_mock and budget_short():
            # T20：预算不足以再发起一次调用 → 直接兜底，不再打模型（也不重试/切备用）
            fallback = True
            error = "已超出生成时间预算（未发起本次调用）"
            client.note_skipped("fill", "budget_exhausted")
            filled = None
        elif is_edit and client.is_mock and client.mock_responder is None:
            # T4 前置：mock 模式增量修改产出确定性改写树（关键词规则、无 LLM），
            # 与下方真实链路共用 repair → validate → compliance 流水线；
            # 与 :443 附近非编辑路径的 mock 特判对称——否则「AI 修改 → 落地闸门」
            # 在无 Key 环境永远走 fallback，E2E/CI 无法覆盖闸门。
            # 注入 mock_responder 的调用方（测试模拟真实 LLM）不走本分支。
            filled = mock_edited_design(prompt, current_design or {})
        else:
            try:
                filled = client.chat_json(
                    fill_system,
                    to_llm_dict(user_payload),
                    settings.llm_temperature_fill,
                    history=history,
                    deadline=deadline,
                    kind="fill",
                )
            except Exception as exc:  # noqa: BLE001
                error = f"参数填充调用失败：{describe_api_error(exc)}"
                filled = None
        ops_applied: list[str] = []
        if filled is None or not isinstance(filled, dict):
            fallback = True
            if not error:
                # T28：区分"限流/超时"与"模型输出的不是合法 JSON"——后者才是最常见的真实原因
                detail = client.last_json_error[:140]
                error = (
                    f"模型返回的内容不是合法 JSON（已自动重试 1 次）：{detail}"
                    if detail
                    else "模型未返回内容（限流或超时）"
                )
            filled = default
        else:
            # T23：编辑模式优先按 ops 落地（显式增量）；返回整树时走下方兼容路径
            ops_removed: set[str] = set()
            if is_edit and isinstance(filled.get("ops"), list):
                filled, ops_applied, ops_removed, ops_reason = apply_ops(current_design or {}, filled["ops"])
                if ops_reason:
                    gen_logger.warning("ops 落地被拒绝：%s", ops_reason)
                    fallback = True
                    error = f"AI 修改指令无法落地（{ops_reason}），画布保持原样"
                    filled = default
                else:
                    gen_logger.info("ops 落地成功：%s 条，影响 %s 个节点", len(ops_applied), len(ops_applied))
            if not fallback:
                # T17：模型常把整棵树包一层——先解包再修复，避免"只差一层壳"整稿回退模板
                unwrapped, source = unwrap_design(filled)
                if unwrapped is not None:
                    if source != "root":
                        gen_logger.info("LLM 输出已解包（%s）", source)
                    filled = unwrapped
                # LLM 产物先宽容修复常见格式错误（type 误写/数值超界/枚举非法/props 类型），
                # T8 起未知组件/未知类型降级、未知键裁剪（不再整树回退），再过 Schema
                filled = repair_design(filled, degraded)
                # T16：编辑结果必须保留既有节点——空壳树能过 Schema，但会把画布清空；
                # T23：只有 remove op 显式声明过的 id 允许消失
                reason = (
                    structure_loss_reason(current_design or {}, filled, allowed_removed=ops_removed) if is_edit else None
                )
                if reason:
                    gen_logger.warning("编辑结果被结构闸门拒绝：%s", reason)
                    fallback = True
                    error = f"AI 修改未保留原有结构（{reason}），画布保持原样"
                    filled = default
                else:
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
        design, fixes, total = enforce_compliance(filled, allowed_extra=user_colors)
    times["compliance_check"] = time.perf_counter() - t0

    # Mock 模式（未配 Key 的演示/测试）：模板稿即"模型输出"，不标记降级；
    # 真实 Key 模式下 LLM 失败才 fallback=True（前端显示失败卡片）
    if client.is_mock and not is_edit:
        fallback = False
        error = ""

    violations = len(fixes)
    rate = compliance_rate(violations, total)
    times["total"] = time.perf_counter() - start_all
    gen_logger.info(
        "生成结束 template=%s fallback=%s 兼容率=%.1f%% 总耗时=%.2fs 阶段=%s",
        template_name, fallback, rate, times["total"],
        {k: round(v, 2) for k, v in times.items()},
    )

    # T21：一次生成的多条记录共享同一兜底状态；span 上挂业务属性（Jaeger 里能直接看出是否降级）
    for call in client.calls:
        call["fallback"] = fallback
    if not client.is_mock:
        for call in client.calls:
            if call["model"]:  # 只把"真正调用过模型"的结果喂给熔断器
                ai_breaker.record(bool(call["ok"]))
    span = trace.get_current_span()
    span.set_attribute("template", template_name)
    span.set_attribute("fallback", fallback)
    span.set_attribute("degraded_count", len(degraded))
    span.set_attribute("model", client.calls[-1]["model"] if client.calls else "")
    span.set_attribute("prompt_version", client.calls[-1]["prompt_version"] if client.calls else "")

    return GenerateResult(
        design=design,
        template=template_name,
        compliance=rate,
        violations=violations,
        style_attrs=total,
        time_ms=times,
        fallback=fallback,
        mock=client.is_mock,
        error=error,
        violations_detail=[asdict(f) for f in fixes],
        degraded=degraded,
        ai_calls=client.calls,
        ops_applied=ops_applied,
    )
