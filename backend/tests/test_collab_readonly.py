"""T46a-3e：只读访客（viewer）在 **DB 写接口** 上必须被拦（403）。

背景：协作网关只挡 Yjs 实时写入；「保存 / 写版本 / 删除」是**另一条写入口**。
只测网关等于"前端看着只读、接口其实能改"。
权限口径：非成员 404（不泄露存在性），成员但 viewer 403（如实告知无权写）。
"""

POSITIVE = {
    "id": "root",
    "type": "frame",
    "children": [{"id": "t1", "type": "text", "props": {"text": "hi"}, "style": {}}],
}


def _register(client, username: str) -> dict[str, str]:
    resp = client.post("/api/auth/register", json={"username": username, "password": f"{username}123"})
    assert resp.status_code == 200, resp.text
    return {"Authorization": f"Bearer {resp.json()['token']}"}


def _owned_workspace(client, headers) -> int:
    resp = client.get("/api/workspaces", headers=headers)
    assert resp.status_code == 200, resp.text
    owned = [w for w in resp.json()["workspaces"] if w["role"] == "owner"]
    assert owned, "注册用户应自带个人工作区（owner）"
    return owned[0]["id"]


def _invite_and_join(client, owner_headers, role: str, member_headers) -> None:
    inv = client.post(
        f"/api/workspaces/{_owned_workspace(client, owner_headers)}/invites",
        headers=owner_headers,
        json={"role": role},
    )
    assert inv.status_code == 200, inv.text
    joined = client.post("/api/workspaces/join", headers=member_headers, json={"token": inv.json()["token"]})
    assert joined.status_code == 200, joined.text


def _create_design(client, headers, name: str) -> int:
    resp = client.post("/api/designs", headers=headers, json={"name": name, "design": POSITIVE})
    assert resp.status_code == 200, resp.text
    return resp.json()["id"]


def test_viewer_cannot_save_write_version_or_delete(client):
    owner = _register(client, "ro_owner1")
    viewer = _register(client, "ro_viewer1")
    _invite_and_join(client, owner, "viewer", viewer)
    design_id = _create_design(client, owner, "只读稿")

    # 读：viewer 可以
    assert client.get(f"/api/designs/{design_id}", headers=viewer).status_code == 200

    # 写：一律 403
    put = client.put(f"/api/designs/{design_id}", headers=viewer, json={"name": "被改名", "design": POSITIVE})
    assert put.status_code == 403, put.text
    assert "只读" in put.json()["detail"]
    assert client.put(f"/api/designs/{design_id}", headers=viewer, json={"name": "只改名"}).status_code == 403
    assert client.post(f"/api/designs/{design_id}/versions", headers=viewer, json={"note": "x"}).status_code == 403
    assert client.delete(f"/api/designs/{design_id}", headers=viewer).status_code == 403

    # 稿件确实没被改动
    after = client.get(f"/api/designs/{design_id}", headers=owner).json()
    assert after["name"] == "只读稿"


def test_editor_can_write(client):
    owner = _register(client, "ro_owner2")
    editor = _register(client, "ro_editor2")
    _invite_and_join(client, owner, "editor", editor)
    design_id = _create_design(client, owner, "可写稿")

    assert client.get(f"/api/designs/{design_id}", headers=editor).status_code == 200
    assert client.put(f"/api/designs/{design_id}", headers=editor, json={"design": POSITIVE}).status_code == 200
    assert client.post(f"/api/designs/{design_id}/versions", headers=editor, json={"note": "e"}).status_code == 200


def test_non_member_gets_404_not_403(client):
    """非成员仍然 404：不能通过 403/404 的差别探出"这份稿件存在"。"""
    owner = _register(client, "ro_owner3")
    outsider = _register(client, "ro_outsider3")
    design_id = _create_design(client, owner, "别人看不见的稿")

    assert client.get(f"/api/designs/{design_id}", headers=outsider).status_code == 404
    assert client.put(f"/api/designs/{design_id}", headers=outsider, json={"design": POSITIVE}).status_code == 404
    assert client.delete(f"/api/designs/{design_id}", headers=outsider).status_code == 404
