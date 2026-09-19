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

    def test_non_ascii_project_name_does_not_500(self, client, auth_headers):
        """中文工程名曾直接 500：Starlette 用 latin-1 编码响应头，非 ASCII 字符抛 UnicodeEncodeError。

        修法：ASCII 兜底名（filename=） + RFC 5987 的 filename*（保留真实名字，
        现代浏览器下载下来仍是「设计导出.zip」）。
        """
        resp = client.post(
            "/api/export",
            json={"files": _EXPORT_FILES, "project_name": "设计导出"},
            headers=auth_headers,
        )
        assert resp.status_code == 200, resp.text
        disposition = resp.headers["content-disposition"]
        assert 'filename="' in disposition and ".zip" in disposition
        assert "filename*=UTF-8''" in disposition
        # 兜底名必须是纯 ASCII（否则又会触发同一个编码错误）
        ascii_part = disposition.split('filename="', 1)[1].split('"', 1)[0]
        ascii_part.encode("ascii")
        assert zipfile.ZipFile(io.BytesIO(resp.content)).testzip() is None

    def test_project_name_with_quote_does_not_break_header(self, client, auth_headers):
        """引号会把 filename="..." 提前闭掉（拼出畸形头），必须被挡在兜底名之外。"""
        resp = client.post(
            "/api/export",
            json={"files": _EXPORT_FILES, "project_name": 'a"b'},
            headers=auth_headers,
        )
        assert resp.status_code == 200
        disposition = resp.headers["content-disposition"]
        quoted = disposition.split('filename="', 1)[1].split('"', 1)[0]
        assert '"' not in quoted and quoted.endswith(".zip")

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
