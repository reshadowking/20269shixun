"""令牌生成物与 design-system.yaml 一致性测试 + /api/tokens 接口测试。"""
import json
import re
from pathlib import Path

import yaml

from app.design import tokens

SHARED_YAML = Path(__file__).resolve().parent.parent.parent / "shared" / "design-system.yaml"
FRONTEND_TS = (
    Path(__file__).resolve().parent.parent.parent / "frontend" / "src" / "design" / "tokens.generated.ts"
)


def test_generated_matches_yaml():
    """生成物必须与唯一规范源一致（跑 generate_tokens.py 后此测试才成立）。"""
    with open(SHARED_YAML, encoding="utf-8") as f:
        source = yaml.safe_load(f)

    assert set(tokens.THEMES) == set(source["themes"].keys())
    for theme in source["themes"]:
        assert tokens.COLORS[theme] == source["themes"][theme]["colors"]
        assert tokens.TYPOGRAPHY[theme] == source["themes"][theme]["typography"]
        assert tokens.SPACING[theme] == source["themes"][theme]["spacing"]
        assert tokens.RADIUS[theme] == source["themes"][theme]["radius"]
    assert tokens.ALLOWED_HEX_COLORS == source.get("allowed_hex_colors", [])


def test_frontend_generated_matches_yaml():
    """前端生成物（画布与导出真正读的那份）也必须与 YAML 一致（2026-09-17 补）。

    背景：后端生成物早有 `test_generated_matches_yaml` 守门，但 `tokens.generated.ts`
    **没有任何对 YAML 的比对** —— 而它才是画布取色、导出取色的来源。一旦它落后于 YAML
    （手工改了那份"DO NOT EDIT"的生成物，或生成脚本的 TS 分支出问题），就会出现
    「合规检查器说这是令牌色、画布上却还是旧颜色」的漂移，而全套测试依旧全绿。

    这里直接解析 TS 里的 `THEMES` / `ALLOWED_HEX_COLORS` 字面量做比对（不引新依赖，
    与 test_icon_library / test_contract 的"跨语言同源"守门同范式）。
    """
    source = yaml.safe_load(SHARED_YAML.read_text(encoding="utf-8"))
    ts = FRONTEND_TS.read_text(encoding="utf-8")
    themes = json.loads(re.search(r"export const THEMES = (\{.*?\}) as const;", ts, re.DOTALL).group(1))
    allowed = json.loads(
        re.search(r"export const ALLOWED_HEX_COLORS: readonly string\[\] = (\[.*?\]);", ts, re.DOTALL).group(1)
    )

    assert set(themes) == set(source["themes"])
    for theme, spec in source["themes"].items():
        assert themes[theme]["colors"] == spec["colors"], f"{theme} 颜色与 YAML 不一致"
        assert themes[theme]["typography"] == spec["typography"], f"{theme} 排版与 YAML 不一致"
        assert themes[theme]["spacing"] == spec["spacing"], f"{theme} 间距与 YAML 不一致"
        assert themes[theme]["radius"] == spec["radius"], f"{theme} 圆角与 YAML 不一致"
    assert allowed == source.get("allowed_hex_colors", [])


def test_color_value_lookup():
    assert tokens.color_value("default", "primary") == "#0052D9"
    assert tokens.color_value("default", "nope") is None
    assert tokens.color_value("dark", "primary") == "#3D7FFF"


def test_is_allowed_color():
    assert tokens.is_allowed_color("default", "#0052D9")       # 令牌 hex
    assert tokens.is_allowed_color("default", "primary")       # 令牌名
    assert tokens.is_allowed_color("default", "#FF6B6B")       # 白名单补充色
    assert not tokens.is_allowed_color("default", "#123456")   # 非令牌色


def test_is_allowed_color_case_insensitive():
    """hex 大小写不敏感：合规检查器与前端同源（v2.2 §4.6）。"""
    assert tokens.is_allowed_color("default", "#ff6b6b")
    assert tokens.is_allowed_color("default", "#0052d9")
    assert tokens.is_allowed_color("default", "#FFFFFF")


def test_nearest_token():
    # 距离 0 的令牌应精确返回自身
    assert tokens.nearest_token("default", "#0052D9") == "primary"
    assert tokens.nearest_token("default", "#1D2129") == "text-primary"
    # 返回结果必须是合法令牌名
    result = tokens.nearest_token("default", "#123456")
    assert result in tokens.COLORS["default"]
    assert tokens.nearest_token("default", "garbage") == "primary"  # 非法输入兜底


def test_api_tokens(client, auth_headers):
    resp = client.get("/api/tokens", headers=auth_headers)
    assert resp.status_code == 200
    body = resp.json()
    assert "default" in body["themes"]
    assert body["colors"]["default"]["primary"] == "#0052D9"
    assert isinstance(body["allowed_hex_colors"], list)
