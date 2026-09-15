"""T46a-4：新稿件归属个人工作区 + 稿件移动接口的权限口径。"""

from app.db import SessionLocal
from app.models import Design, User
from app.services.workspaces import personal_workspace_of

POSITIVE = {
    "id": "root",
    "type": "frame",
    "children": [{"id": "t1", "type": "text", "props": {"text": "hi"}, "style": {}}],
}


def _register(client, username: str) -> dict[str, str]:
    resp = client.post("/api/auth/register", json={"username": username, "password": f"{username}123"})
    assert resp.status_code == 200, resp.text
    return {"Authorization": f"Bearer {resp.json()['token']}"}


def _workspaces(client, headers) -> list[dict]:
    resp = client.get("/api/workspaces", headers=headers)
    assert resp.status_code == 200, resp.text
    return resp.json()["workspaces"]


def _owned_workspace_id(client, headers) -> int:
    owned = [w for w in _workspaces(client, headers) if w["role"] == "owner"]
    assert owned
    return owned[0]["id"]


def _invite_and_join(client, owner_headers, role: str, member_headers, workspace_id: int) -> None:
    inv = client.post(
        f"/api/workspaces/{workspace_id}/invites", headers=owner_headers, json={"role": role}
    )
    assert inv.status_code == 200, inv.text
    joined = client.post("/api/workspaces/join", headers=member_headers, json={"token": inv.json()["token"]})
    assert joined.status_code == 200, joined.text


def test_new_design_belongs_to_personal_workspace(client):
    owner = _register(client, "mv_owner1")
    created = client.post("/api/designs", headers=owner, json={"name": "归属稿", "design": POSITIVE})
    assert created.status_code == 200, created.text
    design_id = created.json()["id"]

    db = SessionLocal()
    try:
        user = db.query(User).filter(User.username == "mv_owner1").one()
        design = db.get(Design, design_id)
        assert design.workspace_id == personal_workspace_of(db, user.id).id
        assert design.workspace_id is not None  # 不再依赖"创建人兜底"
    finally:
        db.close()


def test_move_design_between_own_workspaces(client):
    owner = _register(client, "mv_owner2")
    design_id = client.post("/api/designs", headers=owner, json={"name": "搬家稿", "design": POSITIVE}).json()["id"]
    source_ws = _owned_workspace_id(client, owner)

    # 再建一个"团队工作区"（owner 仍是自己：直接建第二个工作区用邀请不方便，这里用另一账号建 + 邀请我为 editor）
    other = _register(client, "mv_owner2b")
    target_ws = _owned_workspace_id(client, other)
    _invite_and_join(client, other, "editor", owner, target_ws)

    moved = client.post(f"/api/designs/{design_id}/move", headers=owner, json={"workspace_id": target_ws})
    assert moved.status_code == 200, moved.text

    db = SessionLocal()
    try:
        assert db.get(Design, design_id).workspace_id == target_ws
    finally:
        db.close()

    # 目标工作区的成员（other）现在能看到这份稿件
    assert client.get(f"/api/designs/{design_id}", headers=other).status_code == 200
    # 原工作区不再包含它（列表按成员过滤：source_ws 只有我自己，我仍是 target 的成员所以仍可见）
    assert source_ws != target_ws


def test_move_permission_rules(client):
    owner = _register(client, "mv_owner3")
    viewer = _register(client, "mv_viewer3")
    outsider = _register(client, "mv_outsider3")
    design_id = client.post("/api/designs", headers=owner, json={"name": "权限稿", "design": POSITIVE}).json()["id"]

    # viewer 加入来源工作区 → 不能移动（403）
    _invite_and_join(client, owner, "viewer", viewer, _owned_workspace_id(client, owner))
    resp = client.post(f"/api/designs/{design_id}/move", headers=viewer, json={"workspace_id": _owned_workspace_id(client, viewer)})
    assert resp.status_code == 403, resp.text

    # 非成员（没加入来源工作区）→ 404（不泄露存在性）
    resp = client.post(f"/api/designs/{design_id}/move", headers=outsider, json={"workspace_id": _owned_workspace_id(client, outsider)})
    assert resp.status_code == 404, resp.text

    # owner 目标工作区不存在/无权 → 404
    resp = client.post(f"/api/designs/{design_id}/move", headers=owner, json={"workspace_id": 999999})
    assert resp.status_code == 404, resp.text
