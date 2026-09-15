"""§四（2026-09-16 收紧）：草稿/共享链接房间也过网关——必须有合法 JWT。

核心不变量：**房间能对应到稿件时，仍然必须过成员校验**（下面最后一条盯着它）。
"""

import pytest

from app.config import get_settings

INTERNAL = "test-collab-token"


@pytest.fixture()
def collab_token(monkeypatch):
    """authorize 要求配置 COLLAB_INTERNAL_TOKEN，这里注入一个固定值。"""
    settings = get_settings()
    monkeypatch.setattr(settings, "collab_internal_token", INTERNAL)
    return INTERNAL


def _authorize(client, room: str, username: str, token: str):
    resp = client.post(
        "/api/collab/authorize",
        headers={"X-Internal-Token": token},
        json={"room": room, "username": username},
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


def _register(client, username: str) -> None:
    assert client.post("/api/auth/register", json={"username": username, "password": f"{username}123"}).status_code == 200


def test_draft_room_allows_authenticated_user(client, collab_token):
    _register(client, "draft_alice")
    # 草稿房间、E2E 用的自定义房间名都算"共享链接类房间"
    for room in ("session-s-abc12345", "local-ab12cd34", "design-room", "e2e-abc12345"):
        body = _authorize(client, room, "draft_alice", collab_token)
        assert body == {"ok": True, "role": "editor"}, room


def test_unknown_design_room_is_treated_as_shared_room(client, collab_token):
    """`design-<不存在的 id>`：既没有稿件可泄漏，就按共享房间放行（登录即可）。"""
    _register(client, "draft_bob")
    assert _authorize(client, "design-999999", "draft_bob", collab_token) == {"ok": True, "role": "editor"}


def test_unknown_user_rejected_even_for_draft(client, collab_token):
    assert _authorize(client, "session-s-nobody1", "ghost_user", collab_token) == {"ok": False, "role": None}


def test_signed_room_still_member_checked(client, collab_token):
    """草稿放行不能顺手把"签名房间"也放开：非成员进别人的稿件仍然被拒。"""
    _register(client, "draft_owner")
    _register(client, "draft_outsider")
    owner_headers = {
        "Authorization": f"Bearer {client.post('/api/auth/login', json={'username': 'draft_owner', 'password': 'draft_owner123'}).json()['token']}"
    }
    design_id = client.post(
        "/api/designs",
        headers=owner_headers,
        json={"name": "私有稿", "design": {"id": "root", "type": "frame", "children": []}},
    ).json()["id"]
    room = client.get(f"/api/designs/{design_id}/collab", headers=owner_headers).json()["room"]

    assert _authorize(client, room, "draft_owner", collab_token)["ok"] is True
    assert _authorize(client, room, "draft_outsider", collab_token)["ok"] is False
