"""T46a-3：协作房间签发与网关鉴权（成员可见 / 非成员 404 / viewer 只读标记 / 内网令牌）。"""

from app.config import get_settings


def _register(client, username: str) -> dict:
    resp = client.post("/api/auth/register", json={"username": username, "password": f"{username}123"})
    assert resp.status_code == 200, resp.text
    return {"Authorization": f"Bearer {resp.json()['token']}"}


def _design(client, headers, name="协作房间稿") -> int:
    resp = client.post("/api/designs", json={"name": name, "design": {"id": "root", "type": "frame", "children": []}}, headers=headers)
    assert resp.status_code == 200, resp.text
    return resp.json()["id"]


class TestCollabRoom:
    def test_owner_gets_stable_room_and_can_edit(self, client):
        owner = _register(client, "croom1")
        design_id = _design(client, owner)
        first = client.get(f"/api/designs/{design_id}/collab", headers=owner)
        assert first.status_code == 200
        body = first.json()
        assert body["role"] == "owner" and body["can_edit"] is True
        assert len(body["room"]) >= 16  # 不可猜
        second = client.get(f"/api/designs/{design_id}/collab", headers=owner).json()
        assert second["room"] == body["room"]  # 多人拿到同一个房间

    def test_stranger_gets_404(self, client):
        owner, stranger = _register(client, "croom2"), _register(client, "croom2x")
        design_id = _design(client, owner)
        assert client.get(f"/api/designs/{design_id}/collab", headers=stranger).status_code == 404

    def test_viewer_role_marks_read_only(self, client):
        owner, guest = _register(client, "croom3"), _register(client, "croom3x")
        design_id = _design(client, owner)
        ws = client.get("/api/workspaces", headers=owner).json()["workspaces"][0]
        token = client.post(f"/api/workspaces/{ws['id']}/invites", json={"role": "viewer"}, headers=owner).json()["token"]
        client.post("/api/workspaces/join", json={"token": token}, headers=guest)

        body = client.get(f"/api/designs/{design_id}/collab", headers=guest).json()
        assert body["role"] == "viewer" and body["can_edit"] is False


class TestAuthorizeEndpoint:
    def test_requires_internal_token(self, client, monkeypatch):
        monkeypatch.setattr(get_settings(), "collab_internal_token", "internal-secret")
        # 不带内网令牌 → 401
        assert client.post("/api/collab/authorize", json={"room": "r" * 20, "username": "demo"}).status_code == 401

    def test_disabled_without_config(self, client, monkeypatch):
        monkeypatch.setattr(get_settings(), "collab_internal_token", "")
        assert client.post("/api/collab/authorize", json={"room": "r" * 20, "username": "demo"}).status_code == 503

    def test_authorizes_member_and_denies_stranger(self, client, monkeypatch):
        monkeypatch.setattr(get_settings(), "collab_internal_token", "internal-secret")
        owner = _register(client, "cauth1")
        design_id = _design(client, owner)
        room = client.get(f"/api/designs/{design_id}/collab", headers=owner).json()["room"]
        headers = {"X-Internal-Token": "internal-secret"}

        ok = client.post("/api/collab/authorize", json={"room": room, "username": "cauth1"}, headers=headers)
        assert ok.status_code == 200 and ok.json() == {"ok": True, "role": "owner"}

        denied = client.post("/api/collab/authorize", json={"room": room, "username": "nobody-here"}, headers=headers)
        assert denied.json() == {"ok": False, "role": None}

        unknown_room = client.post("/api/collab/authorize", json={"room": "x" * 20, "username": "cauth1"}, headers=headers)
        assert unknown_room.json() == {"ok": False, "role": None}
