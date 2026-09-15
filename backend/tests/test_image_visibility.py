"""T46b：资产可见性三档 + 协作成员自动可读被引用的图片 + 只读/越权口径。

要点：
- `<img src>` 带不了 Authorization 头 → 读取走「Bearer 头 或 design_token cookie」软鉴权，
  public-link 档位再用链接里的 k 当凭证（未登录也能读）。
- 读不到一律 **404**（不泄漏资产是否存在）。
"""
import io

PNG = b"\x89PNG\r\n\x1a\n" + b"0" * 64


def _register(client, username: str) -> dict[str, str]:
    resp = client.post("/api/auth/register", json={"username": username, "password": f"{username}123"})
    assert resp.status_code == 200, resp.text
    return {"Authorization": f"Bearer {resp.json()['token']}"}


def _token(headers: dict[str, str]) -> str:
    return headers["Authorization"].split(" ", 1)[1]


def _upload(client, headers, name="a.png") -> int:
    resp = client.post("/api/images", files={"file": (name, io.BytesIO(PNG), "image/png")}, headers=headers)
    assert resp.status_code == 200, resp.text
    return resp.json()["id"]


def _owned_workspace(client, headers) -> int:
    rows = client.get("/api/workspaces", headers=headers).json()["workspaces"]
    owned = [w for w in rows if w["role"] == "owner"]
    assert owned
    return owned[0]["id"]


def _invite_and_join(client, owner_headers, role: str, member_headers) -> None:
    inv = client.post(
        f"/api/workspaces/{_owned_workspace(client, owner_headers)}/invites", headers=owner_headers, json={"role": role}
    )
    assert inv.status_code == 200, inv.text
    joined = client.post("/api/workspaces/join", headers=member_headers, json={"token": inv.json()["token"]})
    assert joined.status_code == 200, joined.text


def _design_referencing(client, headers, name: str, image_id: int) -> int:
    design = {
        "id": "root",
        "type": "frame",
        "style": {"layout": "column"},
        "children": [
            {
                "id": "img1",
                "type": "component",
                "componentType": "image",
                "props": {"src": f"/api/images/{image_id}"},
                "style": {},
            }
        ],
    }
    resp = client.post("/api/designs", headers=headers, json={"name": name, "design": design})
    assert resp.status_code == 200, resp.text
    return resp.json()["id"]


def _set_visibility(client, headers, image_id: int, visibility: str):
    return client.patch(f"/api/images/{image_id}/visibility", headers=headers, json={"visibility": visibility})


class TestPrivateVisibility:
    def test_owner_reads_with_header_or_cookie_others_404(self, client):
        alice = _register(client, "vis_alice")
        bob = _register(client, "vis_bob")
        image_id = _upload(client, alice)

        assert client.get(f"/api/images/{image_id}", headers=alice).status_code == 200
        # `<img src>` 场景：只有 cookie，没有 Authorization 头
        assert client.get(f"/api/images/{image_id}", cookies={"design_token": _token(alice)}).status_code == 200
        # 别人（没有引用关系）读不到，且是 404 而不是 403
        assert client.get(f"/api/images/{image_id}", headers=bob).status_code == 404
        assert client.get(f"/api/images/{image_id}").status_code == 404

    def test_default_visibility_is_private(self, client):
        alice = _register(client, "vis_default")
        image_id = _upload(client, alice)
        rows = client.get("/api/images", headers=alice).json()["images"]
        row = next(r for r in rows if r["id"] == image_id)
        assert row["visibility"] == "private"
        assert row["referenced_by"] == 0
        assert row["public_url"].startswith(f"/api/images/{image_id}?k=")


class TestWorkspaceVisibility:
    def test_workspace_member_reads_non_member_404(self, client):
        alice = _register(client, "visw_alice")
        member = _register(client, "visw_member")
        outsider = _register(client, "visw_outsider")
        _invite_and_join(client, alice, "viewer", member)
        image_id = _upload(client, alice)
        assert _set_visibility(client, alice, image_id, "workspace").status_code == 200

        assert client.get(f"/api/images/{image_id}", headers=member).status_code == 200
        assert client.get(f"/api/images/{image_id}", headers=outsider).status_code == 404


class TestReferencedImageReadable:
    """T46b 的核心问题：协作者能不能加载到我图里的资源。"""

    def test_private_image_referenced_by_shared_design_is_readable(self, client):
        alice = _register(client, "visr_alice")
        member = _register(client, "visr_member")
        outsider = _register(client, "visr_outsider")
        _invite_and_join(client, alice, "editor", member)

        image_id = _upload(client, alice)  # private
        design_id = _design_referencing(client, alice, "带图的稿", image_id)

        # 协作成员能看到这份稿件 → 就必须能读到稿里的图（否则画布缺图）
        assert client.get(f"/api/designs/{design_id}", headers=member).status_code == 200
        assert client.get(f"/api/images/{image_id}", headers=member).status_code == 200
        # 与本稿无关的人仍然读不到
        assert client.get(f"/api/images/{image_id}", headers=outsider).status_code == 404

    def test_referenced_count_surfaced_to_owner(self, client):
        alice = _register(client, "visc_alice")
        image_id = _upload(client, alice)
        _design_referencing(client, alice, "引用稿", image_id)
        rows = client.get("/api/images", headers=alice).json()["images"]
        assert next(r for r in rows if r["id"] == image_id)["referenced_by"] == 1


class TestPublicLink:
    def test_public_link_needs_key(self, client):
        alice = _register(client, "visp_alice")
        image_id = _upload(client, alice)
        body = _set_visibility(client, alice, image_id, "public-link").json()
        public_url = body["public_url"]

        # 没带 k：未登录读不到（proves 不是"换成 public 就人人可枚举"）
        assert client.get(f"/api/images/{image_id}").status_code == 404
        # 带正确 k：未登录也能读
        assert client.get(public_url).status_code == 200
        # 带错误 k：404
        assert client.get(f"/api/images/{image_id}?k=deadbeefdeadbeef").status_code == 404

    def test_visibility_change_is_owner_only_and_validated(self, client):
        alice = _register(client, "viso_alice")
        bob = _register(client, "viso_bob")
        image_id = _upload(client, alice)

        assert _set_visibility(client, bob, image_id, "public-link").status_code == 404
        assert _set_visibility(client, alice, image_id, "everyone").status_code == 422


class TestDeleteStillChecksReferences:
    def test_referenced_image_cannot_be_deleted_without_force(self, client):
        alice = _register(client, "visd_alice")
        image_id = _upload(client, alice)
        _design_referencing(client, alice, "引用稿", image_id)

        blocked = client.delete(f"/api/images/{image_id}", headers=alice)
        assert blocked.status_code == 409, blocked.text
        assert "引用" in blocked.json()["detail"]
        # force 仍然可以删（明确知情）
        assert client.delete(f"/api/images/{image_id}?force=true", headers=alice).status_code == 200
