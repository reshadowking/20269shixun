"""导出接口测试（P0-2）：zip 打包完整性、路径安全、鉴权。"""

import io
import zipfile

_EXPORT_FILES = {
    "package.json": '{"name": "x", "version": "0.1.0"}',
    "index.html": "<html></html>",
    "src/App.tsx": "export default function App() { return <div>hi</div> }",
    "README.md": "# demo",
}


class TestExportApi:

    def test_export_zip_content(self, client, auth_headers):
        resp = client.post(
            "/api/export",
            json={"files": _EXPORT_FILES, "project_name": "demo-page"},
            headers=auth_headers,
        )
        assert resp.status_code == 200
        assert resp.headers["content-type"] == "application/zip"
        assert "demo-page.zip" in resp.headers["content-disposition"]
        zf = zipfile.ZipFile(io.BytesIO(resp.content))
        names = zf.namelist()
        assert "package.json" in names
        assert "src/App.tsx" in names
        assert "index.html" in names
        assert zf.read("src/App.tsx").decode() == _EXPORT_FILES["src/App.tsx"]

    def test_missing_required_file_rejected(self, client, auth_headers):
        resp = client.post(
            "/api/export",
            json={"files": {"src/App.tsx": "x"}},
            headers=auth_headers,
        )
        assert resp.status_code == 422

    def test_path_traversal_rejected(self, client, auth_headers):
        resp = client.post(
            "/api/export",
            json={"files": {"../evil.txt": "x", "package.json": "{}", "src/App.tsx": "x", "index.html": "x"}},
            headers=auth_headers,
        )
        assert resp.status_code == 422

    def test_export_requires_token(self, client):
        assert client.post("/api/export", json={"files": _EXPORT_FILES}).status_code == 401

    def test_export_zip_runnable_structure(self, client, auth_headers):
        """ZIP 完整保留传入文件（可运行性由前端 engineTemplate 生成内容保证，vitest 覆盖）。"""
        files = {
            "package.json": '{"scripts": {"dev": "vite"}, "dependencies": {"react": "^19.0.0"}, "devDependencies": {"vite": "^6.0.0"}}',
            "index.html": "<html></html>",
            "src/App.tsx": "x",
        }
        resp = client.post("/api/export", json={"files": files}, headers=auth_headers)
        zf = zipfile.ZipFile(io.BytesIO(resp.content))
        import json as j

        pkg = j.loads(zf.read("package.json").decode())
        assert pkg["scripts"]["dev"] == "vite"
        assert "react" in pkg["dependencies"]
