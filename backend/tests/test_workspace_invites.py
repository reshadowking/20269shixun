"""T46a（提交 2）：邀请/成员接口 + 访问判定改为"工作区成员"。"""


def _register(client, username: str) -> dict:
    resp = client.post("/api/auth/register", json={"username": username, "password": f"{username}123"})
    assert resp.status_code == 200, resp.text
    return {"Authorization": f"Bearer {resp.json()['token']}"}


def _my_workspaces(client, headers) -> list[dict]:
    resp = client.get("/api/workspaces", headers=headers)
    assert resp.status_code == 200
    return resp.json()["workspaces"]


class TestInviteFlow:
    def test_invite_editor_and_join(self, client):
        owner, guest = _register(client, "wsowner"), _register(client, "wsguest")
        ws = _my_workspaces(client, owner)[0]
        assert ws["role"] == "owner"

        inv = client.post(f"/api/workspaces/{ws['id']}/invites", json={"role": "editor"}, headers=owner)
        assert inv.status_code == 200
        token = inv.json()["token"]

        joined = client.post("/api/workspaces/join", json={"token": token}, headers=guest)
        assert joined.status_code == 200 and joined.json()["role"] == "editor"
        assert {w["id"]: w["role"] for w in _my_workspaces(client, guest)}[ws["id"]] == "editor"

        # 一次性：再用同一个 token 404
        assert client.post("/api/workspaces/join", json={"token": token}, headers=guest).status_code == 404

    def test_members_list_and_remove(self, client):
        owner, guest = _register(client, "wsowner2"), _register(client, "wsguest2")
        ws = _my_workspaces(client, owner)[0]
        token = client.post(
            f"/api/workspaces/{ws['id']}/invites", json={"role": "viewer"}, headers=owner
        ).json()["token"]
        me = client.get("/api/auth/me", headers=guest).json()["username"]
        client.post("/api/workspaces/join", json={"token": token}, headers=guest)

        members = client.get(f"/api/workspaces/{ws['id']}/members", headers=owner).json()["members"]
        assert {m["username"]: m["role"] for m in members}[me] == "viewer"

        guest_id = next(m["user_id"] for m in members if m["username"] == me)
        assert client.delete(f"/api/workspaces/{ws['id']}/members/{guest_id}", headers=owner).status_code == 200
        after = client.get(f"/api/workspaces/{ws['id']}/members", headers=owner).json()["members"]
        assert guest_id not in [m["user_id"] for m in after]

    def test_non_owner_cannot_invite(self, client):
        owner, guest = _register(client, "wsowner3"), _register(client, "wsguest3")
        ws = _my_workspaces(client, owner)[0]
        token = client.post(f"/api/workspaces/{ws['id']}/invites", json={}, headers=owner).json()["token"]
        client.post("/api/workspaces/join", json={"token": token}, headers=guest)
        assert client.post(f"/api/workspaces/{ws['id']}/invites", json={}, headers=guest).status_code == 403

    def test_unknown_workspace_404_for_stranger(self, client):
        owner, stranger = _register(client, "wsowner4"), _register(client, "wsstranger")
        ws = _my_workspaces(client, owner)[0]
        assert client.get(f"/api/workspaces/{ws['id']}/members", headers=stranger).status_code == 404
        assert client.post(f"/api/workspaces/{ws['id']}/invites", json={}, headers=stranger).status_code == 404


class TestMembershipRace:
    """`workspace_members` 有唯一约束 (workspace_id, user_id)。

    并发 join / 并发"按用户名邀请"同一人时，后到的请求会撞这个约束——
    必须按幂等 / 409 处理，而不是把 IntegrityError 冒成 500（2026-09-17 实测）。
    两条用例都用"存在性检查看不到已有成员"的打桩**确定性地**复现那个竞态窗口。
    """

    def test_join_race_is_idempotent_not_500(self, client, monkeypatch):
        owner, guest = _register(client, "raceowner1"), _register(client, "raceguest1")
        ws = _my_workspaces(client, owner)[0]
        t1 = client.post(f"/api/workspaces/{ws['id']}/invites", json={"role": "viewer"}, headers=owner).json()["token"]
        assert client.post("/api/workspaces/join", json={"token": t1}, headers=guest).json()["role"] == "viewer"

        # 第二张邀请：模拟"同一刻另一个窗口也在加入"
        t2 = client.post(f"/api/workspaces/{ws['id']}/invites", json={"role": "editor"}, headers=owner).json()["token"]
        from app.routers import workspaces as ws_router

        real_member = ws_router._member
        calls = {"n": 0}

        def race_member(db, workspace_id, user_id):
            calls["n"] += 1
            if calls["n"] == 1:
                return None  # 检查那一刻"还不是成员"
            return real_member(db, workspace_id, user_id)

        monkeypatch.setattr(ws_router, "_member", race_member)
        resp = client.post("/api/workspaces/join", json={"token": t2}, headers=guest)
        monkeypatch.setattr(ws_router, "_member", real_member)

        assert resp.status_code == 200, f"并发加入应幂等成功，实际 {resp.status_code}"
        assert resp.json()["role"] == "viewer", "不降级也不升级：保持既有角色"

    def test_invite_by_username_race_is_409_not_500(self, client, monkeypatch):
        owner = _register(client, "raceowner2")
        _register(client, "raceguest2")  # 目标账号必须先存在（invite_by_username 要求已注册）
        ws = _my_workspaces(client, owner)[0]
        body = {"username": "raceguest2", "role": "viewer"}
        assert client.post(f"/api/workspaces/{ws['id']}/invites/by-username", json=body, headers=owner).status_code == 200

        members = client.get(f"/api/workspaces/{ws['id']}/members", headers=owner).json()["members"]
        target_id = next(m["user_id"] for m in members if m["username"] == "raceguest2")

        from app.routers import workspaces as ws_router

        real_member = ws_router._member
        calls = {"target": 0}

        def race_member(db, workspace_id, user_id):
            # 邀请方自己的成员校验照常；只让"目标是否已是成员"这次假装查不到
            if user_id == target_id:
                calls["target"] += 1
                if calls["target"] == 1:
                    return None  # 检查那一刻"还不是成员"
            return real_member(db, workspace_id, user_id)

        monkeypatch.setattr(ws_router, "_member", race_member)
        resp = client.post(f"/api/workspaces/{ws['id']}/invites/by-username", json=body, headers=owner)
        monkeypatch.setattr(ws_router, "_member", real_member)

        assert resp.status_code == 409, f"竞态下应回 409（已是成员），实际 {resp.status_code}"
        assert "已是成员" in resp.json()["detail"]


class TestDesignAccessByMembership:
    def _create_design(self, client, headers, name="跨账号协作稿"):
        design = {"id": "root", "type": "frame", "children": []}
        resp = client.post("/api/designs", json={"name": name, "design": design}, headers=headers)
        assert resp.status_code == 200, resp.text
        return resp.json()["id"]

    def test_member_can_read_design_after_join(self, client):
        owner, guest = _register(client, "daowner"), _register(client, "dabguest")
        design_id = self._create_design(client, owner)
        # 加入前：非成员读到 404（本卡之前"两个人打不开同一份稿"的真因）
        assert client.get(f"/api/designs/{design_id}", headers=guest).status_code == 404

        ws = _my_workspaces(client, owner)[0]
        token = client.post(f"/api/workspaces/{ws['id']}/invites", json={"role": "editor"}, headers=owner).json()["token"]
        client.post("/api/workspaces/join", json={"token": token}, headers=guest)

        # 加入后：同一份稿可用（且能看到名字）
        ok = client.get(f"/api/designs/{design_id}", headers=guest)
        assert ok.status_code == 200 and ok.json()["name"] == "跨账号协作稿"

    def test_removed_member_loses_access(self, client):
        owner, guest = _register(client, "daowner2"), _register(client, "dabguest2")
        design_id = self._create_design(client, owner, name="移除后不可见")
        ws = _my_workspaces(client, owner)[0]
        token = client.post(f"/api/workspaces/{ws['id']}/invites", json={}, headers=owner).json()["token"]
        client.post("/api/workspaces/join", json={"token": token}, headers=guest)
        assert client.get(f"/api/designs/{design_id}", headers=guest).status_code == 200

        guest_id = client.get("/api/auth/me", headers=guest)
        assert guest_id.status_code == 200
        members = client.get(f"/api/workspaces/{ws['id']}/members", headers=owner).json()["members"]
        target = next(m["user_id"] for m in members if m["username"] == "dabguest2")
        client.delete(f"/api/workspaces/{ws['id']}/members/{target}", headers=owner)
        assert client.get(f"/api/designs/{design_id}", headers=guest).status_code == 404
