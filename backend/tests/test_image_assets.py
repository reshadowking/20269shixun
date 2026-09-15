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
