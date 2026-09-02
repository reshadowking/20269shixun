"""令牌生成物与 design-system.yaml 一致性测试 + /api/tokens 接口测试。"""
from pathlib import Path

import yaml

from app.design import tokens

SHARED_YAML = Path(__file__).resolve().parent.parent.parent / "shared" / "design-system.yaml"


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
