"""T38：资产归属与配额（列表只含本人 / 他人不可删 / 配额上限 / 删除清理记录）。"""
import io

from app.db import SessionLocal
from app.models import Image

PNG = b"\x89PNG\r\n\x1a\n" + b"0" * 64


def _upload(client, headers, filename="a.png"):
    return client.post("/api/images", files={"file": (filename, io.BytesIO(PNG), "image/png")}, headers=headers)


class TestAssetOwnership:
    def test_upload_then_list_only_returns_mine(self, client, auth_headers):
        up = _upload(client, auth_headers)
        assert up.status_code == 200
        body = client.get("/api/images", headers=auth_headers).json()
        assert [img["id"] for img in body["images"]] == [up.json()["id"]]
        assert body["used_bytes"] == len(PNG)
        assert body["limit_count"] > 0 and body["limit_bytes"] > 0

    def test_upload_records_owner(self, client, auth_headers):
        image_id = _upload(client, auth_headers).json()["id"]
        db = SessionLocal()
        try:
            row = db.get(Image, image_id)
            assert row is not None and row.owner_id != 0
        finally:
            db.close()

    def test_next_user_sees_empty_list_and_cannot_delete_mine(self, client, auth_headers):
        mine = _upload(client, auth_headers).json()["id"]
        ghost = client.post("/api/auth/login", json={"username": "ghost", "password": "ghost123"})
        if ghost.status_code == 200:
            ghost_headers = {"Authorization": f"Bearer {ghost.json()['token']}"}
            assert client.get("/api/images", headers=ghost_headers).json()["images"] == []
            assert client.delete(f"/api/images/{mine}", headers=ghost_headers).status_code == 404

    def test_delete_removes_row(self, client, auth_headers):
        image_id = _upload(client, auth_headers).json()["id"]
        assert client.delete(f"/api/images/{image_id}", headers=auth_headers).status_code == 200
        # 测试共用一个库文件：断言"这条已不在列表里"，而不是列表为空
        ids = [img["id"] for img in client.get("/api/images", headers=auth_headers).json()["images"]]
        assert image_id not in ids
        db = SessionLocal()
        try:
            assert db.get(Image, image_id) is None
        finally:
            db.close()


class TestAssetReference:
    """T47：被设计稿引用的资产不能静默删除（防"删了自己的图，协作方变缺图"）。"""

    def _design_referencing(self, client, auth_headers, image_id: int):
        design = {
            "id": "root",
            "type": "frame",
            "children": [
                {
                    "id": "img",
                    "type": "component",
                    "componentType": "image",
                    "props": {"src": f"/api/images/{image_id}", "alt": "x"},
                }
            ],
        }
        return client.post("/api/designs", json={"name": "引用图的设计稿", "design": design}, headers=auth_headers)

    def test_delete_blocked_when_referenced(self, client, auth_headers):
        image_id = _upload(client, auth_headers).json()["id"]
        created = self._design_referencing(client, auth_headers, image_id)
        assert created.status_code == 200

        blocked = client.delete(f"/api/images/{image_id}", headers=auth_headers)
        assert blocked.status_code == 409
        assert "仍被" in blocked.json()["detail"]
        # 强制删除仍然允许（数据可回收，只是不静默）
        assert client.delete(f"/api/images/{image_id}?force=true", headers=auth_headers).status_code == 200

    def test_delete_allowed_when_not_referenced(self, client, auth_headers):
        """未被引用的资产可删除。

        注意：测试库是 SQLite，删除后 id 会**复用**，先前用例创建的设计稿可能正好引用到这个"新" id——
        因此这里断言"删除成功，或先被守卫拦下再用 force 成功"（guard 的主契约在另一个用例里确定性断言）。
        """
        image_id = _upload(client, auth_headers).json()["id"]
        resp = client.delete(f"/api/images/{image_id}", headers=auth_headers)
        assert resp.status_code in (200, 409), resp.text
        if resp.status_code == 409:
            assert client.delete(f"/api/images/{image_id}?force=true", headers=auth_headers).status_code == 200


class TestAssetQuota:
    def test_count_quota_blocks_upload(self, client, auth_headers, monkeypatch):
        from app.routers import images as images_router

        # 以"当前已用数量"为上限 → 下一次上传必然超限（不依赖库是否干净）
        used = len(client.get("/api/images", headers=auth_headers).json()["images"])
        monkeypatch.setattr(images_router, "MAX_ASSETS_PER_USER", used)
        resp = _upload(client, auth_headers)
        assert resp.status_code == 422
        assert "数量已达上限" in resp.json()["detail"]

    def test_bytes_quota_blocks_upload(self, client, auth_headers, monkeypatch):
        from app.routers import images as images_router

        used = client.get("/api/images", headers=auth_headers).json()["used_bytes"]
        monkeypatch.setattr(images_router, "MAX_BYTES_PER_USER", used)
        resp = _upload(client, auth_headers)
        assert resp.status_code == 422
        assert "总容量已达上限" in resp.json()["detail"]
