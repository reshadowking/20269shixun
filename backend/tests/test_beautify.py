"""缺陷 3：美化阶段写入层白名单（服务端铁闸）。

核心验收：绕过 UI 直接构造请求也必须被拒绝——布局/结构/文本字段、白名单外的效果键、
非预置取值一律 422；合法效果只写白名单 style 键，且结果仍通过 DesignNode Schema。
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
SHARED = json.loads((ROOT / "shared" / "beautify-effects.json").read_text(encoding="utf-8"))

EFFECT_KEYS = [k["key"] for k in SHARED["keys"]]
SIZE_KEYS = [k["key"] for k in SHARED["keys"] if k["changesSize"]]

TREE = {
    "id": "root",
    "type": "frame",
    "style": {"layout": "column", "width": 800, "height": 600},
    "children": [
        {"id": "card-1", "type": "component", "componentType": "card", "props": {"title": "标题"}, "style": {"width": 320}},
    ],
}


def _post(client, headers, effects, node_id="card-1", design=None):
    return client.post(
        "/api/apply-effects",
        json={"design": design or TREE, "node_id": node_id, "effects": effects},
        headers=headers,
    )


class TestApplyEffectsWhitelist:
    def test_apply_whitelisted_effect(self, client, auth_headers):
        resp = _post(client, auth_headers, {"shadow": "0 4px 12px rgba(29,33,41,0.10)"})
        assert resp.status_code == 200
        body = resp.json()
        card = body["design"]["children"][0]
        assert card["style"]["shadow"] == "0 4px 12px rgba(29,33,41,0.10)"
        assert card["style"]["width"] == 320  # 既有样式保持不变
        assert body["applied"] == ["shadow"]
        assert body["changes_size"] is False

    def test_does_not_mutate_input_tree(self, client, auth_headers):
        _post(client, auth_headers, {"shadow": "0 4px 12px rgba(29,33,41,0.10)"})
        assert "shadow" not in TREE["children"][0]["style"]

    def test_layout_field_rejected(self, client, auth_headers):
        """绕过 UI 直接提交布局改动 → 422（美化阶段禁止改布局）。"""
        resp = _post(client, auth_headers, {"layout": "grid"})
        assert resp.status_code == 422
        assert "layout" in resp.json()["detail"]

    def test_text_and_structure_rejected(self, client, auth_headers):
        for payload in ({"props": {"title": "改文案"}}, {"children": []}, {"type": "text"}, {"x": 10}, {"width": 400}):
            resp = _post(client, auth_headers, payload)
            assert resp.status_code == 422, f"{payload} 应被拒绝"
            assert "拒绝" in resp.json()["detail"]

    def test_non_preset_value_rejected(self, client, auth_headers):
        """同 key 但取值不在预置集合（自由 CSS 注入）→ 422。"""
        resp = _post(client, auth_headers, {"shadow": "0 0 0 red; background: url(http://evil/x.png)"})
        assert resp.status_code == 422
        resp2 = _post(client, auth_headers, {"backgroundImage": "url(http://evil/x.png)"})
        assert resp2.status_code == 422

    def test_all_whitelist_keys_apply(self, client, auth_headers):
        """白名单内每个 key 的每个预置值都能写入。"""
        for spec in SHARED["keys"]:
            for preset in spec["values"]:
                resp = _post(client, auth_headers, {spec["key"]: preset["value"]})
                assert resp.status_code == 200, f"{spec['key']}={preset['value']} 应被接受"

    def test_remove_effect_with_null(self, client, auth_headers):
        design = json.loads(json.dumps(TREE))
        design["children"][0]["style"]["shadow"] = "0 4px 12px rgba(29,33,41,0.10)"
        resp = _post(client, auth_headers, {"shadow": None}, design=design)
        assert resp.status_code == 200
        assert "shadow" not in resp.json()["design"]["children"][0]["style"]
        assert resp.json()["removed"] == ["shadow"]

    def test_size_changing_effect_flagged(self, client, auth_headers):
        resp = _post(client, auth_headers, {"transform": "scale(1.04)"})
        assert resp.status_code == 200
        assert resp.json()["changes_size"] is True

    def test_unknown_node_rejected(self, client, auth_headers):
        resp = _post(client, auth_headers, {"shadow": "0 4px 12px rgba(29,33,41,0.10)"}, node_id="nope")
        assert resp.status_code == 422

    def test_result_still_schema_valid(self, client, auth_headers):
        from app.design.validator import validate_design_safe

        body = _post(client, auth_headers, {"backgroundImage": "linear-gradient(135deg, #0052D9 0%, #7C4DFF 100%)", "radius": 16}).json()
        ok, errors = validate_design_safe(body["design"])
        assert ok, errors[:3]

    def test_requires_auth(self, client):
        assert client.post("/api/apply-effects", json={"design": TREE, "node_id": "card-1", "effects": {"shadow": None}}).status_code == 401


class TestBeautifyContract:
    def test_backend_whitelist_matches_shared_file(self):
        """服务端白名单与 shared/beautify-effects.json 完全一致（防漂移）。"""
        from app.services.beautify import EFFECT_CHANGES_SIZE, EFFECT_KEYS, EFFECT_VALUES

        assert EFFECT_KEYS == [k["key"] for k in SHARED["keys"]]
        for spec in SHARED["keys"]:
            assert EFFECT_VALUES[spec["key"]] == {v["value"] for v in spec["values"]}
            assert EFFECT_CHANGES_SIZE[spec["key"]] is bool(spec["changesSize"])

    def test_size_flag_keys_are_declared_in_shared(self):
        assert SIZE_KEYS == ["border", "transform"]
