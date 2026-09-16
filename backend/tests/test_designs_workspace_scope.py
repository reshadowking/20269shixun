"""验收发现的缺口回归：**成员能在列表里看到被移进工作区的稿件**。

此前 `GET /api/designs` 只按 `owner_id == 我` 过滤 → 权限通、界面空（"我的项目 0 份"），
邀请流程在 UI 上是断的。现在改为"我所在工作区的稿件 ∪ 我创建的稿件"，并逐行带 workspace_name/my_role。
"""

POSITIVE = {"id": "root", "type": "frame", "children": [{"id": "t1", "type": "text", "props": {"text": "hi"}, "style": {}}]}


def _register(client, username: str) -> dict[str, str]:
    resp = client.post("/api/auth/register", json={"username": username, "password": f"{username}123"})
    assert resp.status_code == 200, resp.text
    return {"Authorization": f"Bearer {resp.json()['token']}"}


def _owned_workspace(client, headers) -> int:
    rows = client.get("/api/workspaces", headers=headers).json()["workspaces"]
    owned = [w for w in rows if w["role"] == "owner"]
    assert owned
    return owned[0]["id"]


def _invite(client, headers, workspace_id: int, username: str, role: str):
    return client.post(
        f"/api/workspaces/{workspace_id}/invites/by-username",
        headers=headers,
        json={"username": username, "role": role},
    )


def _list(client, headers) -> dict:
    resp = client.get("/api/designs", headers=headers)
    assert resp.status_code == 200, resp.text
    return resp.json()


def _create(client, headers, name: str) -> int:
    resp = client.post("/api/designs", headers=headers, json={"name": name, "design": POSITIVE})
    assert resp.status_code == 200, resp.text
    return resp.json()["id"]


def test_workspace_member_sees_shared_design_with_role(client):
    owner = _register(client, "scope_owner")
    editor = _register(client, "scope_editor")
    viewer = _register(client, "scope_viewer")
    ws = _owned_workspace(client, owner)
    assert _invite(client, owner, ws, "scope_editor", "editor").status_code == 200
    assert _invite(client, owner, ws, "scope_viewer", "viewer").status_code == 200

    design_id = _create(client, owner, "共享稿")

    # owner / editor / viewer 三方列表里都能看到它，并带上工作区名与各自的角色
    for headers, username, role in ((owner, "scope_owner", "owner"), (editor, "scope_editor", "editor"), (viewer, "scope_viewer", "viewer")):
        body = _list(client, headers)
        row = next((d for d in body["designs"] if d["id"] == design_id), None)
        assert row is not None, username
        assert row["my_role"] == role, username
        assert row["workspace_name"], username
        assert body["total"] >= 1


def test_moved_design_appears_in_target_members_list(client):
    """核心回归：A 把稿件移进 B 的工作区 → **B 的列表里必须出现**（此前是空的）。"""
    alice = _register(client, "scope_alice")
    bob = _register(client, "scope_bob")
    bob_ws = _owned_workspace(client, bob)
    assert _invite(client, bob, bob_ws, "scope_alice", "editor").status_code == 200

    design_id = _create(client, alice, "搬过去的稿")
    assert _list(client, bob)["designs"] == []  # 还没移：bob 看不到
    moved = client.post(f"/api/designs/{design_id}/move", headers=alice, json={"workspace_id": bob_ws})
    assert moved.status_code == 200, moved.text

    body = _list(client, bob)
    assert [d["id"] for d in body["designs"]] == [design_id]
    assert body["total"] == 1
    assert body["designs"][0]["my_role"] == "owner"  # bob 是该工作区 owner
    assert body["designs"][0]["workspace_name"] == "scope_bob 的工作区"


def test_outsider_does_not_see_design(client):
    owner = _register(client, "scope_owner2")
    outsider = _register(client, "scope_outsider2")
    design_id = _create(client, owner, "私有稿")
    assert _list(client, owner)["designs"][0]["id"] == design_id
    assert _list(client, outsider)["designs"] == []


def test_viewer_role_surfaced_for_readonly_card(client):
    """viewer 的卡片要能标"只读"——所以列表必须把角色带出来。"""
    owner = _register(client, "scope_owner3")
    viewer = _register(client, "scope_viewer3")
    ws = _owned_workspace(client, owner)
    assert _invite(client, owner, ws, "scope_viewer3", "viewer").status_code == 200
    design_id = _create(client, owner, "只读共享稿")

    row = next(d for d in _list(client, viewer)["designs"] if d["id"] == design_id)
    assert row["my_role"] == "viewer"
    # 只读访客不能改：写接口 403（与列表口径一致）
    assert client.put(f"/api/designs/{design_id}", headers=viewer, json={"design": POSITIVE}).status_code == 403
