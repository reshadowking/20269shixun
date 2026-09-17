"""图片上传接口测试（D2）：上传/类型白名单/大小上限/鉴权/读取。"""
from pathlib import Path

from app.config import get_settings

PNG_BYTES = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64  # 文件头即可，服务端不做魔数校验


class TestImageUpload:
    def test_upload_and_fetch(self, client, auth_headers):
        resp = client.post(
            "/api/images",
            files={"file": ("a.png", PNG_BYTES, "image/png")},
            headers=auth_headers,
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["url"].startswith("/api/images/")
        img_id = body["id"]

        # T46b：读取要过可见性判定——上传者用 Bearer 读得到
        got = client.get(f"/api/images/{img_id}", headers=auth_headers)
        assert got.status_code == 200
        assert got.headers["content-type"] == "image/png"
        assert got.content.startswith(b"\x89PNG")

    def test_private_image_not_public(self, client, auth_headers):
        """T46b：默认 private 的资产，匿名请求读不到（此前是无条件公开）。"""
        img_id = client.post(
            "/api/images", files={"file": ("a.png", PNG_BYTES, "image/png")}, headers=auth_headers
        ).json()["id"]
        assert client.get(f"/api/images/{img_id}").status_code == 404

    def test_upload_rejects_disallowed_type(self, client, auth_headers):
        resp = client.post(
            "/api/images",
            files={"file": ("evil.svg", b"<svg/>", "image/svg+xml")},
            headers=auth_headers,
        )
        assert resp.status_code == 422  # svg 含脚本面，拒绝

    def test_upload_rejects_oversize(self, client, auth_headers):
        resp = client.post(
            "/api/images",
            files={"file": ("big.png", b"x" * (2 * 1024 * 1024 + 1), "image/png")},
            headers=auth_headers,
        )
        assert resp.status_code == 422

    def test_upload_requires_auth(self, client):
        resp = client.post("/api/images", files={"file": ("a.png", PNG_BYTES, "image/png")})
        assert resp.status_code == 401

    def test_fetch_missing_returns_404(self, client):
        assert client.get("/api/images/99999").status_code == 404

    def test_uploads_go_to_isolated_storage_not_repo_dir(self, client, auth_headers):
        """上传落点必须是测试临时目录，不能是开发者的 backend/designs/images。

        2026-09-17：这条守门是为了记住事故——测试长期往真实资产目录写文件，
        全量跑一次就多几十个 72 字节孤儿（本地已累计 932 个）。
        """
        root = Path(get_settings().storage_root).resolve()
        repo_assets = Path(__file__).resolve().parent.parent / "designs" / "images"
        assert root != repo_assets.resolve(), "测试上传不能写进仓库的 designs/images"
        assert repo_assets.resolve() not in root.parents

    def test_quota_rejection_leaves_no_orphan_file(self, client, auth_headers, monkeypatch):
        """超配额必须**先拒绝再落盘**：原来的顺序会留下无人引用的孤儿文件。"""
        from app.routers import images as images_router

        monkeypatch.setattr(images_router, "MAX_ASSETS_PER_USER", 0)
        storage = Path(get_settings().storage_root)
        resp = client.post("/api/images", files={"file": ("a.png", PNG_BYTES, "image/png")}, headers=auth_headers)
        assert resp.status_code == 422
        assert "上限" in resp.json()["detail"]
        written = list(storage.glob("*")) if storage.exists() else []
        assert written == [], f"配额拒绝后不该留下文件，实际留下 {len(written)} 个"
