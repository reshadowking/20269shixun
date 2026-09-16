"""T46a-4 第 3 件：按用户名直接邀请（不经链接）+ /collab 暴露 workspace_id。"""


def _register(client, username: str) -> dict[str, str]:
    resp = client.post("/api/auth/register", json={"username": username, "password": f"{username}123"})
    assert resp.status_code == 200, resp.text
    return {"Authorization": f"Bearer {resp.json()['token']}"}


def _owned_workspace(client, headers) -> int:
    rows = client.get("/api/workspaces", headers=headers).json()["workspaces"]
    owned = [w for w in rows if w["role"] == "owner"]
    assert owned
    return owned[0]["id"]


def _members(client, headers, workspace_id: int) -> list[dict]:
    resp = client.get(f"/api/workspaces/{workspace_id}/members", headers=headers)
    assert resp.status_code == 200, resp.text
    return resp.json()["members"]


def _invite(client, headers, workspace_id: int, username: str, role: str = "editor"):
    return client.post(
        f"/api/workspaces/{workspace_id}/invites/by-username",
        headers=headers,
        json={"username": username, "role": role},
    )


def test_invite_by_username_adds_member(client):
    owner = _register(client, "byn_owner")
    guest = _register(client, "byn_guest")
    workspace_id = _owned_workspace(client, owner)

    resp = _invite(client, owner, workspace_id, "byn_guest", "viewer")
    assert resp.status_code == 200, resp.text
    assert resp.json() == {"ok": True, "username": "byn_guest", "role": "viewer"}

    roles = {m["username"]: m["role"] for m in _members(client, owner, workspace_id)}
    assert roles["byn_guest"] == "viewer"
    # 对方视角：工作区已出现在自己的列表里
    ids = [w["id"] for w in client.get("/api/workspaces", headers=guest).json()["workspaces"]]
    assert workspace_id in ids


def test_invite_by_username_unknown_account(client):
    """账号不存在 → 404 且提示先注册（不自动给对方建号）。"""
    owner = _register(client, "byn_owner2")
    workspace_id = _owned_workspace(client, owner)
    resp = _invite(client, owner, workspace_id, "nobody_here", "editor")
    assert resp.status_code == 404, resp.text
    assert "注册" in resp.json()["detail"]


def test_invite_by_username_permission_and_validation(client):
    owner = _register(client, "byn_owner3")
    outsider = _register(client, "byn_outsider3")
    workspace_id = _owned_workspace(client, owner)

    # 非成员 → 404（不泄漏工作区是否存在）
    assert _invite(client, outsider, workspace_id, "byn_outsider3").status_code == 404
    # 邀请自己 → 422
    assert _invite(client, owner, workspace_id, "byn_owner3").status_code == 422
    # 角色非法 → 422
    assert _invite(client, owner, workspace_id, "byn_outsider3", "admin").status_code == 422


def test_invite_by_username_existing_member_409(client):
    owner = _register(client, "byn_owner4")
    member = _register(client, "byn_member4")
    workspace_id = _owned_workspace(client, owner)

    assert _invite(client, owner, workspace_id, "byn_member4", "viewer").status_code == 200
    again = _invite(client, owner, workspace_id, "byn_member4", "editor")
    assert again.status_code == 409, again.text
    assert "已是成员" in again.json()["detail"]
    assert member  # 保留引用：member 账号本身没别的用途，避免 linter 误判未使用


def test_editor_can_only_invite_viewer(client):
    """2026-09-16 决策：放宽到 editor，但**可邀角色上限为 viewer**（"谁能写"始终由 owner 决定）。"""
    owner = _register(client, "byn_owner5")
    editor = _register(client, "byn_editor5")
    _register(client, "byn_watcher5")
    _register(client, "byn_another5")
    workspace_id = _owned_workspace(client, owner)

    assert _invite(client, owner, workspace_id, "byn_editor5", "editor").status_code == 200
    # editor 邀 viewer：允许
    assert _invite(client, editor, workspace_id, "byn_watcher5", "viewer").status_code == 200
    # editor 邀 editor：拒绝（否则权限链可以无限延长）
    denied = _invite(client, editor, workspace_id, "byn_another5", "editor")
    assert denied.status_code == 403, denied.text
    assert "只读" in denied.json()["detail"]
    # 被拒的那位确实没进成员表；被允许的 viewer 在
    usernames = {m["username"] for m in _members(client, owner, workspace_id)}
    assert "byn_watcher5" in usernames and "byn_another5" not in usernames


def test_editor_can_only_create_viewer_link(client):
    """链接邀请与按用户名邀请同一套规则（不能一条路宽一条路窄）。"""
    owner = _register(client, "byn_owner7")
    editor = _register(client, "byn_editor7")
    workspace_id = _owned_workspace(client, owner)
    assert _invite(client, owner, workspace_id, "byn_editor7", "editor").status_code == 200

    ok = client.post(f"/api/workspaces/{workspace_id}/invites", headers=editor, json={"role": "viewer"})
    assert ok.status_code == 200, ok.text
    denied = client.post(f"/api/workspaces/{workspace_id}/invites", headers=editor, json={"role": "editor"})
    assert denied.status_code == 403, denied.text


def test_viewer_cannot_invite_at_all(client):
    """只读访客不是邀请方——404/403 都不能过（口径：owner / editor 才可邀请）。"""
    owner = _register(client, "byn_owner8")
    viewer = _register(client, "byn_viewer8")
    workspace_id = _owned_workspace(client, owner)
    assert _invite(client, owner, workspace_id, "byn_viewer8", "viewer").status_code == 200

    assert _invite(client, viewer, workspace_id, "byn_owner8").status_code == 403
    assert client.post(f"/api/workspaces/{workspace_id}/invites", headers=viewer, json={"role": "viewer"}).status_code == 403


def test_collab_endpoint_exposes_workspace_id(client):
    owner = _register(client, "byn_owner6")
    workspace_id = _owned_workspace(client, owner)
    design_id = client.post(
        "/api/designs",
        headers=owner,
        json={"name": "带工作区的稿", "design": {"id": "root", "type": "frame", "children": []}},
    ).json()["id"]

    body = client.get(f"/api/designs/{design_id}/collab", headers=owner).json()
    assert body["role"] == "owner"
    assert body["workspace_id"] == workspace_id
