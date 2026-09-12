"""T4 批3：批量美化端点（POST /api/apply-effects/batch）。

核心约束：
- 白名单判定的唯一执行点仍是 beautify.apply_effects()——批量端点只逐 target 复用它，
  不得复制第二份判定逻辑（T3/T5-0 教训）；
- 原子性：任一 target 非法（白名单外 / 非预置值 / 节点不存在）→ 整批 422，
  返回的 design 不产生"半应用"（前端拿到 422 时画布保持原样）；
- 旧端点 /api/apply-effects 行为不变（回归）。
"""
import json

SHADOW = "0 4px 12px rgba(29,33,41,0.10)"

TREE = {
    "id": "root",
    "type": "frame",
    "style": {"layout": "column", "width": 800, "height": 600},
    "children": [
        {"id": "card-1", "type": "component", "componentType": "card", "props": {"title": "A"}, "style": {"width": 320}},
        {"id": "card-2", "type": "component", "componentType": "card", "props": {"title": "B"}, "style": {"width": 320}},
        {"id": "card-3", "type": "component", "componentType": "card", "props": {"title": "C"}, "style": {"width": 320}},
    ],
}


def _post_batch(client, headers, targets, design=None):
    return client.post(
        "/api/apply-effects/batch",
        json={"design": design if design is not None else json.loads(json.dumps(TREE)), "targets": targets},
        headers=headers,
    )


class TestApplyEffectsBatch:
    def test_multi_targets_all_applied(self, client, auth_headers):
        """多 target 成功：每个目标都落了效果，applied 以 node_id.key 列出全部。"""
        resp = _post_batch(client, auth_headers, [
            {"node_id": "card-1", "effects": {"shadow": SHADOW}},
            {"node_id": "card-2", "effects": {"shadow": SHADOW}},
            {"node_id": "card-3", "effects": {"radius": 16}},
        ])
        assert resp.status_code == 200
        body = resp.json()
        assert body["applied"] == ["card-1.shadow", "card-2.shadow", "card-3.radius"]
        assert body["changes_size"] is False
        assert body["failed"] == []
        for i, node in enumerate(body["design"]["children"]):
            expected = SHADOW if i < 2 else 16
            assert node["style"][("shadow" if i < 2 else "radius")] == expected
            assert node["style"]["width"] == 320  # 既有样式保持不变
        # 既有 props 未被误改
        assert [n["props"]["title"] for n in body["design"]["children"]] == ["A", "B", "C"]

    def test_any_invalid_target_rejects_whole_batch(self, client, auth_headers):
        """原子性：任一 target 非白名单 → 整批 422，无半应用。"""
        resp = _post_batch(client, auth_headers, [
            {"node_id": "card-1", "effects": {"shadow": SHADOW}},
            {"node_id": "card-2", "effects": {"layout": "grid"}},  # 非白名单键
        ])
        assert resp.status_code == 422
        # 设计树逐字段不变（半应用比整批失败更难排查）
        resp2 = _post_batch(client, auth_headers, [
            {"node_id": "card-1", "effects": {"shadow": SHADOW}},
            {"node_id": "card-2", "effects": {"shadow": "0 0 0 red"}},  # 非预置值
        ])
        assert resp2.status_code == 422

    def test_empty_targets_rejected(self, client, auth_headers):
        resp = _post_batch(client, auth_headers, [])
        assert resp.status_code == 422

    def test_missing_node_rejects_whole_batch(self, client, auth_headers):
        """node_id 不存在：整批拒绝（原子性取舍，理由见端点 docstring），并给可读原因。"""
        resp = _post_batch(client, auth_headers, [
            {"node_id": "card-1", "effects": {"shadow": SHADOW}},
            {"node_id": "nope", "effects": {"shadow": SHADOW}},
        ])
        assert resp.status_code == 422
        assert "nope" in resp.json()["detail"]

    def test_non_preset_value_rejected(self, client, auth_headers):
        resp = _post_batch(client, auth_headers, [
            {"node_id": "card-1", "effects": {"backgroundImage": "url(http://evil/x.png)"}},
        ])
        assert resp.status_code == 422

    def test_changes_size_flag_or_across_targets(self, client, auth_headers):
        """任一 target 含 changesSize 效果 → 汇总为 True（前端据此提示）。"""
        resp = _post_batch(client, auth_headers, [
            {"node_id": "card-1", "effects": {"shadow": SHADOW}},
            {"node_id": "card-2", "effects": {"transform": "scale(1.04)"}},
        ])
        assert resp.status_code == 200
        assert resp.json()["changes_size"] is True

    def test_removal_with_null_across_targets(self, client, auth_headers):
        design = json.loads(json.dumps(TREE))
        for node in design["children"]:
            node["style"]["shadow"] = SHADOW
        resp = _post_batch(client, auth_headers, [
            {"node_id": "card-1", "effects": {"shadow": None}},
            {"node_id": "card-2", "effects": {"shadow": None}},
        ], design=design)
        assert resp.status_code == 200
        body = resp.json()
        assert body["removed"] == ["card-1.shadow", "card-2.shadow"]
        assert "shadow" not in body["design"]["children"][0]["style"]
        assert "shadow" not in body["design"]["children"][1]["style"]
        assert body["design"]["children"][2]["style"]["shadow"] == SHADOW  # 未涉及的节点不动

    def test_result_still_schema_valid(self, client, auth_headers):
        from app.design.validator import validate_design_safe

        body = _post_batch(client, auth_headers, [
            {"node_id": "card-1", "effects": {"backgroundImage": "linear-gradient(135deg, #0052D9 0%, #7C4DFF 100%)", "radius": 16}},
            {"node_id": "card-2", "effects": {"animation": "fade-in"}},
        ]).json()
        ok, errors = validate_design_safe(body["design"])
        assert ok, errors[:3]

    def test_requires_auth(self, client):
        resp = client.post(
            "/api/apply-effects/batch",
            json={"design": TREE, "targets": [{"node_id": "card-1", "effects": {"shadow": SHADOW}}]},
        )
        assert resp.status_code == 401


class TestSingleEndpointUnchanged:
    """回归：旧端点 /api/apply-effects 行为不变（批3 不动单人路径）。"""

    def test_single_apply_still_works(self, client, auth_headers):
        resp = client.post(
            "/api/apply-effects",
            json={"design": json.loads(json.dumps(TREE)), "node_id": "card-1", "effects": {"shadow": SHADOW}},
            headers=auth_headers,
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["applied"] == ["shadow"]  # 旧契约：不带 node_id 前缀
        assert "failed" not in body  # 旧响应结构未变

    def test_single_apply_still_rejects_non_preset(self, client, auth_headers):
        resp = client.post(
            "/api/apply-effects",
            json={"design": json.loads(json.dumps(TREE)), "node_id": "card-1", "effects": {"shadow": "evil"}},
            headers=auth_headers,
        )
        assert resp.status_code == 422
