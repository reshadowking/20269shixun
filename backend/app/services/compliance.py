"""规范兼容性检查器（v2.2 §4.6：指标 ≥85% 的实现与测量）。

遍历 DesignNode 树的 style 颜色字段（color/background）：
- 令牌色 / 白名单 hex（大小写不敏感）→ 通过
- 违规值 → 自动拉回最近令牌色，记录 violations
compliance = (1 - violations / 总样式属性数) × 100%
"""
import copy
import re
from typing import Any

from ..design import tokens

COLOR_FIELDS = ("color", "background")
_HEX_RE = re.compile(r"^#[0-9a-fA-F]{6}$")
# 品牌色系判定：色相角度差阈值 + 最低饱和度（排除灰/黑白）
_BRAND_HUE_DIFF = 40
_BRAND_MIN_SATURATION = 0.05  # 仅排除纯灰（浅蓝/深蓝灰饱和度低但仍是品牌色系）
# 中性色豁免：低饱和度灰阶（文本/边框通用色）不算品牌违规
_NEUTRAL_MAX_SATURATION = 0.2


def _hex_rgb(value: str) -> tuple[int, int, int] | None:
    m = _HEX_RE.match(value)
    if not m:
        return None
    return int(value[1:3], 16), int(value[3:5], 16), int(value[5:7], 16)


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


def enforce_compliance(design: dict[str, Any], allowed_extra: list[str] | None = None) -> tuple[dict[str, Any], int, int]:
    """返回 (修正后的树, 违规数, 总样式属性数)。

    口径（v2.2 §4.6）：总样式属性数 = 全部颜色字段（令牌名/hex 都算）；
    违规 = 非令牌值，自动拉回最近令牌色。
    allowed_extra：用户明确指定的品牌色（#hex）——精确或相近色不拉回（v2.2 §4.5）；
    其余违规色优先拉回用户品牌色（视觉保持用户主题）。
    """
    extra = [c.upper() for c in (allowed_extra or [])]
    design = copy.deepcopy(design)
    violations = 0
    total = 0

    def walk(node: dict[str, Any]) -> None:
        nonlocal violations, total
        style = node.get("style")
        if isinstance(style, dict):
            for key, value in style.items():
                if key in COLOR_FIELDS and isinstance(value, str):
                    total += 1
                    if tokens.is_allowed_color("default", value):
                        continue
                    if value.upper() in extra or _is_brand_family(value, extra):
                        continue  # 用户指定品牌色（含同色相变体）：保留
                    rgb = _hex_rgb(value)
                    hs = _hue_sat(rgb) if rgb else None
                    if hs is not None and hs[1] < _NEUTRAL_MAX_SATURATION:
                        continue  # 低饱和中性灰（文本/边框通用色）：不算品牌违规
                    # 违规：优先拉回用户品牌色（保持主题），否则最近令牌
                    if extra:
                        style[key] = extra[0]
                    else:
                        style[key] = tokens.nearest_token("default", value) if _HEX_RE.match(value) else "primary"
                    violations += 1
        for child in node.get("children") or []:
            walk(child)

    walk(design)
    return design, violations, total


def compliance_rate(violations: int, total: int) -> float:
    """兼容率：无样式属性时视为 100%。"""
    if total == 0:
        return 100.0
    return round((1 - violations / total) * 100, 1)
