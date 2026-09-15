"""规范兼容性检查器（v2.2 §4.6：指标 ≥85% 的实现与测量）。

遍历 DesignNode 树的 style 颜色字段（color/background）：
- 令牌色 / 白名单 hex（大小写不敏感）→ 通过
- 违规值 → 自动拉回最近令牌色，记录 ComplianceFix 明细（B2-2：合规能回答"改了什么"）
compliance = (1 - violations / 总样式属性数) × 100%，violations = len(fixes)
"""
import copy
import logging
import re
from dataclasses import dataclass
from typing import Any

from ..design import tokens

logger = logging.getLogger("ai.gen")  # 与生成链路同一日志通道（backend/logs/generate.log）

COLOR_FIELDS = ("color", "background")
_HEX_RE = re.compile(r"^#[0-9a-fA-F]{6}$")
# T19：合法 hex 的三种形态（3/6/8 位）——归一后再判定，归一后非 hex 的写法不再被改写
_HEX_ANY_RE = re.compile(r"^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$")
# T19：合法但非令牌的颜色写法（CSS 关键字 / 函数式）——直接放行，不再兜底改成 primary
_PASSTHROUGH_COLORS = {"transparent", "none", "inherit", "currentcolor", "initial", "unset"}
_FUNC_COLOR_RE = re.compile(r"^(rgb|rgba|hsl|hsla)\([^;{}<>\"'\\]*\)$", re.IGNORECASE)
# 品牌色系判定：色相角度差阈值 + 最低饱和度（排除灰/黑白）
_BRAND_HUE_DIFF = 40
_BRAND_MIN_SATURATION = 0.05  # 仅排除纯灰（浅蓝/深蓝灰饱和度低但仍是品牌色系）
# 中性色豁免：低饱和度灰阶（文本/边框通用色）不算品牌违规
_NEUTRAL_MAX_SATURATION = 0.2


@dataclass
class ComplianceFix:
    """单条合规拉回记录（原违规值 → 修正值），供逐项报告 UI 与"还原此项"使用。"""

    node_id: str
    field: str  # color / background
    original: str
    corrected: str


def _hex_rgb(value: str) -> tuple[int, int, int] | None:
    m = _HEX_RE.match(value)
    if not m:
        return None
    return int(value[1:3], 16), int(value[3:5], 16), int(value[5:7], 16)


def _normalize_hex(value: str) -> str | None:
    """合法 hex 归一为 6 位大写（#abc → #AABBCC；#RRGGBBAA 取前 6 位）；非 hex 返回 None。

    T19：修掉"`#fff` 被判非法 → 兜底改成 primary"的历史缺陷。
    """
    if not _HEX_ANY_RE.match(value):
        return None
    body = value[1:]
    if len(body) == 3:
        body = "".join(c * 2 for c in body)
    return "#" + body[:6].upper()


def _hue_sat(rgb: tuple[int, int, int]) -> tuple[float, float] | None:
    """RGB → (色相 0-360, 饱和度 0-1)；黑白灰返回 None。"""
    r, g, b = (v / 255.0 for v in rgb)
    mx, mn = max(r, g, b), min(r, g, b)
    delta = mx - mn
    if delta == 0:
        return None
    if mx == r:
        h = ((g - b) / delta) % 6
    elif mx == g:
        h = (b - r) / delta + 2
    else:
        h = (r - g) / delta + 4
    sat = delta / mx
    return h * 60, sat


def _is_brand_family(value: str, brand_colors: list[str]) -> bool:
    """与用户品牌色同色相（含明暗/深浅变体）：实现"XX主题"时的合理色系不拉回。"""
    rgb = _hex_rgb(value)
    if not rgb:
        return False
    hs = _hue_sat(rgb)
    if not hs:
        return False
    h, sat = hs
    if sat < _BRAND_MIN_SATURATION:
        return False
    for brand in brand_colors:
        brgb = _hex_rgb(brand)
        if not brgb:
            continue
        bhs = _hue_sat(brgb)
        if not bhs:
            continue
        diff = abs(h - bhs[0])
        diff = min(diff, 360 - diff)
        if diff < _BRAND_HUE_DIFF:
            return True
    return False


def enforce_compliance(design: dict[str, Any], allowed_extra: list[str] | None = None) -> tuple[dict[str, Any], list[ComplianceFix], int]:
    """返回 (修正后的树, 违规明细列表, 总样式属性数)。

    口径（v2.2 §4.6）：总样式属性数 = 全部颜色字段（令牌名/hex 都算）；
    违规 = 非令牌值，自动拉回最近令牌色并记录 ComplianceFix（node_id/field/original/corrected）。
    allowed_extra：用户明确指定的品牌色（#hex）——精确或相近色不拉回（v2.2 §4.5）；
    其余违规色优先拉回用户品牌色（视觉保持用户主题）。
    """
    extra = [c.upper() for c in (allowed_extra or [])]
    design = copy.deepcopy(design)
    fixes: list[ComplianceFix] = []
    total = 0

    def walk(node: dict[str, Any]) -> None:
        nonlocal total
        node_id = str(node.get("id") or "?")
        style = node.get("style")
        if isinstance(style, dict):
            for key, value in style.items():
                if key in COLOR_FIELDS and isinstance(value, str):
                    total += 1
                    if tokens.is_allowed_color("default", value):
                        continue
                    # T19：CSS 关键字/函数式写法是合法值，直接放行（此前会一路落到 "primary"）
                    stripped = value.strip()
                    if stripped.lower() in _PASSTHROUGH_COLORS or _FUNC_COLOR_RE.match(stripped):
                        continue
                    normalized = _normalize_hex(stripped)
                    if normalized is None:
                        # 既不是令牌色、也不是可判定的 hex：保持原值、不计违规（不再改写整棵树）
                        logger.warning("合规检查无法判定的颜色值 %r（节点 %s.%s）——保持原值", value, node_id, key)
                        continue
                    if tokens.is_allowed_color("default", normalized):
                        continue  # 归一后是合法色（如 #FFFFFF80 带 alpha）：保留原写法
                    if value.upper() in extra or normalized in extra or _is_brand_family(normalized, extra):
                        continue  # 用户指定品牌色（含同色相变体）：保留
                    rgb = _hex_rgb(normalized)
                    hs = _hue_sat(rgb) if rgb else None
                    if hs is not None and hs[1] < _NEUTRAL_MAX_SATURATION:
                        continue  # 低饱和中性灰（文本/边框通用色）：不算品牌违规
                    # 违规：优先拉回用户品牌色（保持主题），否则最近令牌
                    corrected = extra[0] if extra else tokens.nearest_token("default", normalized)
                    style[key] = corrected
                    fixes.append(ComplianceFix(node_id=node_id, field=key, original=value, corrected=corrected))
        for child in node.get("children") or []:
            walk(child)

    walk(design)
    return design, fixes, total


def compliance_rate(violations: int, total: int) -> float:
    """兼容率：无样式属性时视为 100%。"""
    if total == 0:
        return 100.0
    return round((1 - violations / total) * 100, 1)
