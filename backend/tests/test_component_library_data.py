"""组件库 / Schema / clamp 三者的数据自检（2026-09-18）。

为什么要这道门：`shared/component-library.json` 的 `default_style` 是**组件插入画布时的初始值**，
而 `shared/design-schema.json` 的边界与后端 `STYLE_BOUNDS`（生成链路对模型输出做的 clamp）
是同一套口径的三个副本。任何一处飘了都会出现"画布上能写、后端给夹掉/反之"的
**两边不一致**（历史上就踩过 `background: "card"` 这种不是令牌、也不是 hex 的色值）。

本文件只做**数据**校验，不测渲染：
1. 后端 clamp 的数值边界/枚举与 Schema 声明逐项一致（Schema 没声明 min/max 的字段跳过，
   例如 fontWeight 允许 "bold" 这类 CSS 字符串，故没有数值边界）；
2. 组件库每个组件的 default_style 数值落在 Schema 范围内、枚举合法；
3. default_style 里的颜色值必须是令牌名或允许的 hex——不许再出现"看着像颜色其实无效"的值。
"""
import json
from pathlib import Path

from app.design import tokens
from app.services.generate import STYLE_BOUNDS, STYLE_ENUMS

ROOT = Path(__file__).resolve().parents[2]
LIBRARY = json.loads((ROOT / "shared" / "component-library.json").read_text(encoding="utf-8"))
SCHEMA = json.loads((ROOT / "shared" / "design-schema.json").read_text(encoding="utf-8"))
STYLE_PROPS = SCHEMA["properties"]["style"]["properties"]

COLOR_KEYS = {"color", "background", "border"}


class TestBoundsStayInSync:
    def test_numeric_bounds_match_schema(self):
        drift = []
        for key, (lo, hi) in STYLE_BOUNDS.items():
            declared = STYLE_PROPS.get(key) or {}
            if "minimum" not in declared and "maximum" not in declared:
                continue  # 该字段允许字符串（如 fontWeight 的 bold），不声明数值边界
            if declared.get("minimum") != lo or declared.get("maximum") != hi:
                drift.append((key, (lo, hi), (declared.get("minimum"), declared.get("maximum"))))
        assert drift == [], f"后端 clamp 边界与 Schema 不一致：{drift}"

    def test_styles_enums_match_schema(self):
        drift = []
        for key, allowed in STYLE_ENUMS.items():
            declared = set((STYLE_PROPS.get(key) or {}).get("enum") or [])
            if declared != set(allowed):
                drift.append((key, sorted(allowed), sorted(declared)))
        assert drift == [], f"枚举白名单与 Schema 不一致：{drift}"


class TestLibraryDefaultsAreValid:
    def test_numeric_defaults_within_schema_bounds(self):
        bad = []
        for comp in LIBRARY["components"]:
            for key, value in (comp.get("default_style") or {}).items():
                declared = STYLE_PROPS.get(key) or {}
                if not isinstance(value, (int, float)) or isinstance(value, bool):
                    continue
                lo, hi = declared.get("minimum"), declared.get("maximum")
                if lo is not None and value < lo:
                    bad.append((comp["type"], key, value, f"< {lo}"))
                if hi is not None and value > hi:
                    bad.append((comp["type"], key, value, f"> {hi}"))
        assert bad == [], f"组件库默认值越界：{bad}"

    def test_enum_defaults_are_legal(self):
        bad = []
        for comp in LIBRARY["components"]:
            for key, value in (comp.get("default_style") or {}).items():
                allowed = (STYLE_PROPS.get(key) or {}).get("enum")
                if allowed and value not in allowed:
                    bad.append((comp["type"], key, value, allowed))
        assert bad == [], f"组件库默认枚举非法：{bad}"

    def test_color_defaults_are_tokens_or_allowed_hex(self):
        """颜色必须是令牌名或允许的 hex —— 挡的就是"历史遗留的 background: card"那类值。"""
        bad = []
        for comp in LIBRARY["components"]:
            for key, value in (comp.get("default_style") or {}).items():
                if key in COLOR_KEYS and isinstance(value, str) and not tokens.is_allowed_color("default", value):
                    bad.append((comp["type"], key, value))
        assert bad == [], f"组件库默认色不是令牌也不是允许的 hex：{bad}"
