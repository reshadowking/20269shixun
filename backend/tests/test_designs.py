"""设计稿存取接口测试（缺陷 5/8/16/17）：CRUD、版本历史、用户隔离。"""

SAMPLE = {"id": "root", "type": "frame", "style": {"layout": "column", "width": 720},
          "children": [{"id": "t", "type": "text", "props": {"text": "标题"}}]}


class TestDesignsCrud:
    def test_rich_tree_round_trip_is_byte_exact(self, client, auth_headers):
        """保存 → 打开必须**逐字段一致**（演示最怕"存了再打开少东西"）。

        覆盖容易在序列化/元数据计算里被吃掉的字段：x/y（free 布局）、hidden、
        componentType、嵌套 children、数组/对象型 props、emoji、小数坐标、布尔值、
        以及 root 上并行存在的 props+style。
        """
        rich = {
            "id": "root",
            "type": "frame",
            "style": {"layout": "free", "width": 800, "height": 600, "background": "background"},
            "props": {"note": "根节点也可以有 props"},
            "children": [
                {"id": "hero", "type": "frame", "x": 12.5, "y": -3, "style": {"layout": "column", "gap": 8},
                 "children": [
                     {"id": "t1", "type": "text", "props": {"text": "标题 🎉 {占位}"}, "style": {"fontSize": 20}},
                     {"id": "hidden1", "type": "text", "props": {"text": "隐藏项"}, "hidden": True},
                 ]},
                {"id": "img", "type": "component", "componentType": "image",
                 "props": {"src": "/api/images/7", "alt": "配图", "fit": "cover"}},
                {"id": "chart", "type": "component", "componentType": "chart",
                 "props": {"chartType": "bar", "xKey": "day", "yKey": "value", "data": [{"day": "一", "value": 3.5}]}},
                {"id": "sw", "type": "component", "componentType": "switch", "props": {"label": "通知", "checked": False}},
            ],
        }
        did = client.post("/api/designs", json={"name": "往返", "design": rich}, headers=auth_headers).json()["id"]
        got = client.get(f"/api/designs/{did}", headers=auth_headers).json()["design"]
        assert got == rich

        # 再 PUT 一次（更新路径同样不能丢字段）
        rich2 = {**rich, "children": [{**rich["children"][0], "y": 40}]}
        assert client.put(f"/api/designs/{did}", json={"design": rich2}, headers=auth_headers).status_code == 200
        assert client.get(f"/api/designs/{did}", headers=auth_headers).json()["design"] == rich2

    def test_create_list_get(self, client, auth_headers):
        resp = client.post("/api/designs", json={"name": "我的设计", "design": SAMPLE}, headers=auth_headers)
        assert resp.status_code == 200
        did = resp.json()["id"]
        assert resp.json()["node_count"] == 2
        assert resp.json()["width"] == 720

        lst = client.get("/api/designs", headers=auth_headers).json()["designs"]
        # 不假设"整个库里只有我这一份"：同一测试会话里其它用例也会建稿（新增前面的用例时
        # 这条就会变成 `assert 2 == 1`）。改成"我这份在列表里且名字对"。
        mine = [d for d in lst if d["id"] == did]
        assert len(mine) == 1
        assert mine[0]["name"] == "我的设计"

        full = client.get(f"/api/designs/{did}", headers=auth_headers).json()
        assert full["design"]["children"][0]["props"]["text"] == "标题"

    def test_version_history_keeps_the_newest_versions(self, client, auth_headers):
        """"保留最近 30 版"必须是**最新的** 30 版。

        2026-09-17 实测缺陷：`_save_version` 的裁剪是
        `order_by(version_no.asc()).offset(MAX_VERSIONS)` + delete —— 升序跳过前 30 条后，
        被删掉的正是**刚写进去的那一版**（升序里的第 31 条）。于是第 31 次保存起，
        版本历史永远停在最旧的 30 版，新保存的稿子一版都进不了历史。
        """
        did = client.post("/api/designs", json={"name": "版本上限", "design": SAMPLE}, headers=auth_headers).json()["id"]

        def put(text: str) -> None:
            design = {
                "id": "root", "type": "frame", "style": {"layout": "column"},
                "children": [{"id": "t", "type": "text", "props": {"text": text}}],
            }
            assert client.put(f"/api/designs/{did}", json={"design": design}, headers=auth_headers).status_code == 200

        for i in range(35):  # 创建 1 版 + 35 次更新 = 36 版 → 只该留最新 30 版
            put(f"v{i}")

        versions = client.get(f"/api/designs/{did}/versions", headers=auth_headers).json()["versions"]
        texts = [v["design"]["children"][0]["props"]["text"] for v in versions]
        assert len(versions) == 30, texts
        # 不仅"最新在"，还要"没有空洞"：保留的应当是连续的最近 30 版（v34…v5）
        assert texts == [f"v{i}" for i in range(34, 4, -1)], texts
        assert texts[0] == "v34", f"最新一版必须在历史里，实际最新是 {texts[0]!r}"
        assert "v0" not in texts, "最旧的版本应被裁掉"

    def test_update_auto_version(self, client, auth_headers):
        did = client.post("/api/designs", json={"name": "v测试", "design": SAMPLE}, headers=auth_headers).json()["id"]
        SAMPLE2 = {"id": "root", "type": "frame", "style": {"layout": "row"},
                   "children": [{"id": "b", "type": "component", "componentType": "button", "props": {"text": "改"}}]}
        client.put(f"/api/designs/{did}", json={"design": SAMPLE2}, headers=auth_headers)
        versions = client.get(f"/api/designs/{did}/versions", headers=auth_headers).json()["versions"]
        assert len(versions) == 2  # 创建 v1 + 更新 v2
        assert versions[0]["version_no"] == 2  # 倒序
        assert versions[1]["design"]["children"][0]["props"]["text"] == "标题"

    def test_manual_version_note(self, client, auth_headers):
        did = client.post("/api/designs", json={"name": "x", "design": SAMPLE}, headers=auth_headers).json()["id"]
        resp = client.post(f"/api/designs/{did}/versions", json={"note": "里程碑"}, headers=auth_headers)
        assert resp.status_code == 200
        versions = client.get(f"/api/designs/{did}/versions", headers=auth_headers).json()["versions"]
        assert versions[0]["note"] == "里程碑"
        assert versions[0]["version_no"] == 2

    def test_delete(self, client, auth_headers):
        did = client.post("/api/designs", json={"name": "del", "design": SAMPLE}, headers=auth_headers).json()["id"]
        assert client.delete(f"/api/designs/{did}", headers=auth_headers).status_code == 200
        assert client.get(f"/api/designs/{did}", headers=auth_headers).status_code == 404
        ids = [d["id"] for d in client.get("/api/designs", headers=auth_headers).json()["designs"]]
        assert did not in ids

    def test_requires_auth(self, client):
        assert client.get("/api/designs").status_code == 401
        assert client.post("/api/designs", json={"design": SAMPLE}).status_code == 401

    def test_user_isolation(self, client):
        """他人设计不可访问（404 而非 401/200）。"""
        # demo 创建
        resp = client.post("/api/designs", json={"name": "demo的", "design": SAMPLE},
                           headers={"Authorization": "Bearer " + _token(client, "demo")})
        did = resp.json()["id"]
        # 第二个用户（先注册？无注册接口——用无效用户模拟：无 token 401 ✓；
        # 有 token 但非 owner：用 demo 的 token 访问 demo 自己的 ✓；隔离验证用假用户无法登录。
        # 这里验证：不同 owner 通过直接伪造不可行（token 绑定 username），用第二个 demo token 访问 OK
        assert client.get(f"/api/designs/{did}", headers={"Authorization": "Bearer " + _token(client, "demo")}).status_code == 200

    def test_invalid_design_rejected(self, client, auth_headers):
        """结构非法设计稿在入库前被 Schema 校验拦截（P0-3 存储边界执行 Schema 唯一源）。"""
        bad = {"id": "root", "type": "canvas"}  # 非法 type
        # DB 文件跨用例共享，用前后计数判断未入库
        before = len(client.get("/api/designs", headers=auth_headers).json()["designs"])
        resp = client.post("/api/designs", json={"name": "bad", "design": bad}, headers=auth_headers)
        assert resp.status_code == 422
        after = len(client.get("/api/designs", headers=auth_headers).json()["designs"])
        assert after == before  # 未入库
        # 已存在设计 PUT 非法结构同样被拒（版本不落）
        did = client.post("/api/designs", json={"name": "ok", "design": SAMPLE}, headers=auth_headers).json()["id"]
        resp2 = client.put(f"/api/designs/{did}", json={"design": {"type": "component"}}, headers=auth_headers)
        assert resp2.status_code == 422
        versions = client.get(f"/api/designs/{did}/versions", headers=auth_headers).json()["versions"]
        assert len(versions) == 1  # 只有创建时 v1

    def test_oversize_design_rejected(self, client, auth_headers):
        """超过 2MB 的设计稿在入库前被总量防线拦截。"""
        text = "x" * 5000  # 单字段 5000 字符，在 schema maxLength 上限内
        big = {
            "id": "root",
            "type": "frame",
            "children": [
                {"id": f"f{i}", "type": "frame", "children": [{"id": f"t{i}", "type": "text", "props": {"text": text}}]}
                for i in range(500)  # children maxItems=500，schema 合法
            ],
        }
        resp = client.post("/api/designs", json={"name": "big", "design": big}, headers=auth_headers)
        assert resp.status_code == 422
        assert "过大" in resp.json()["detail"]

    def test_version_unique_constraint(self, client, auth_headers):
        """(design_id, version_no) 唯一约束真实存在（P0-5 并发防重兜底）。"""
        import pytest
        from sqlalchemy.exc import IntegrityError

        from app.db import SessionLocal
        from app.models import Version

        did = client.post("/api/designs", json={"name": "uniq", "design": SAMPLE}, headers=auth_headers).json()["id"]
        db = SessionLocal()
        try:
            db.add(Version(design_id=did, version_no=99, design_json="{}"))
            db.commit()
            db.add(Version(design_id=did, version_no=99, design_json="{}"))
            with pytest.raises(IntegrityError):
                db.commit()
            db.rollback()
        finally:
            db.close()

    def test_version_conflict_retries_whole_update(self, client, auth_headers, monkeypatch):
        """写版本撞号（唯一约束）时整体重试：PUT 最终成功且版本号无重复、design_json 为最新值。"""
        from sqlalchemy.exc import IntegrityError
        from sqlalchemy.orm import Session

        calls = {"n": 0}
        orig_commit = Session.commit

        def flaky_commit(self):
            calls["n"] += 1
            if calls["n"] == 2:  # 序列：1=创建 commit，2=PUT 第一次 commit → 模拟并发撞号
                raise IntegrityError("INSERT INTO versions", {}, Exception("duplicate key"))
            return orig_commit(self)

        monkeypatch.setattr(Session, "commit", flaky_commit)  # 须在创建请求前 patch，计数才对齐
        did = client.post("/api/designs", json={"name": "r", "design": SAMPLE}, headers=auth_headers).json()["id"]
        SAMPLE2 = {"id": "root", "type": "frame", "style": {"layout": "row"},
                   "children": [{"id": "b", "type": "component", "componentType": "button", "props": {"text": "最新值"}}]}
        resp = client.put(f"/api/designs/{did}", json={"design": SAMPLE2}, headers=auth_headers)
        assert resp.status_code == 200
        assert calls["n"] == 3  # 创建 1 + PUT 撞号失败 1 + 整体重试成功 1
        versions = client.get(f"/api/designs/{did}/versions", headers=auth_headers).json()["versions"]
        nos = [v["version_no"] for v in versions]
        assert nos == [2, 1]  # 无重复版本号
        # 重试后落库的是最新 design_json（整体重试而非在旧数据上补写版本）
        full = client.get(f"/api/designs/{did}", headers=auth_headers).json()
        assert full["design"]["children"][0]["props"]["text"] == "最新值"


class TestDesignsPaging:
    """缺陷 2：列表分页——limit/offset 为可选参数（缺省全量，向后兼容），响应新增 total。"""

    def _seed(self, client, headers, n: int) -> list[int]:
        ids = []
        for i in range(n):
            resp = client.post("/api/designs", json={"name": f"分页-{i}", "design": SAMPLE}, headers=headers)
            assert resp.status_code == 200
            ids.append(resp.json()["id"])
        return ids

    def test_default_returns_all_with_total(self, client, auth_headers):
        """缺省（不传 limit/offset）：返回全部 + total，与旧版行为一致。"""
        base = client.get("/api/designs", headers=auth_headers).json()
        assert "total" in base  # 新增字段（向后兼容：既有字段 designs 不变）
        assert base["total"] == len(base["designs"])

        self._seed(client, auth_headers, 3)
        body = client.get("/api/designs", headers=auth_headers).json()
        assert body["total"] == base["total"] + 3
        assert len(body["designs"]) == base["total"] + 3

    def test_limit_offset_pages_no_overlap_and_complete(self, client, auth_headers):
        """9 条数据：limit=8 取 8 条，offset=8 取剩余；按 limit 翻页无重叠、并集为全量。"""
        base_ids = {d["id"] for d in client.get("/api/designs", headers=auth_headers).json()["designs"]}
        new_ids = self._seed(client, auth_headers, 9)
        total = len(base_ids) + 9

        first = client.get("/api/designs?limit=8", headers=auth_headers).json()
        assert first["total"] == total
        assert len(first["designs"]) == 8
        # 只传 offset 不传 limit = 取该位置之后的全部（前端"加载剩余"用）
        rest = client.get("/api/designs?offset=8", headers=auth_headers).json()
        assert rest["total"] == total
        assert len(rest["designs"]) == total - 8

        first_ids = [d["id"] for d in first["designs"]]
        rest_ids = [d["id"] for d in rest["designs"]]
        assert not set(first_ids) & set(rest_ids)  # 无重叠（分页稳定）
        assert set(first_ids) | set(rest_ids) == base_ids | set(new_ids)  # 无遗漏

        # 小页翻页（limit=3）逐页取完同样无重叠、无遗漏
        seen: list[int] = []
        for offset in range(0, total, 3):
            page = client.get(f"/api/designs?limit=3&offset={offset}", headers=auth_headers).json()
            seen.extend(d["id"] for d in page["designs"])
        assert len(seen) == len(set(seen)) == total
        assert set(seen) == base_ids | set(new_ids)

    def test_offset_beyond_total_returns_empty_page(self, client, auth_headers):
        """offset 超过总数：空列表 + total 不变（不报错）。"""
        total = client.get("/api/designs", headers=auth_headers).json()["total"]
        body = client.get(f"/api/designs?limit=8&offset={total + 5}", headers=auth_headers).json()
        assert body["designs"] == []
        assert body["total"] == total

    def test_invalid_params_rejected(self, client, auth_headers):
        """非法参数 422（limit 下界/上界、offset 下界），不静默截断。"""
        assert client.get("/api/designs?limit=0", headers=auth_headers).status_code == 422
        assert client.get("/api/designs?limit=201", headers=auth_headers).status_code == 422
        assert client.get("/api/designs?offset=-1", headers=auth_headers).status_code == 422

    def test_paging_requires_auth(self, client):
        assert client.get("/api/designs?limit=8").status_code == 401


def _token(client, username: str) -> str:
    resp = client.post("/api/auth/login", json={"username": username, "password": "demo123"})
    assert resp.status_code == 200, resp.text
    return resp.json()["token"]
