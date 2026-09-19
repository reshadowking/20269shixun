"""列表搜索与排序（2026-09-16）：`q` 与访问作用域**叠加**，`sort` 走白名单。"""

POSITIVE = {"id": "root", "type": "frame", "children": [{"id": "t1", "type": "text", "props": {"text": "hi"}, "style": {}}]}


def _register(client, username: str) -> dict[str, str]:
    resp = client.post("/api/auth/register", json={"username": username, "password": f"{username}123"})
    assert resp.status_code == 200, resp.text
    return {"Authorization": f"Bearer {resp.json()['token']}"}


def _create(client, headers, name: str) -> int:
    resp = client.post("/api/designs", headers=headers, json={"name": name, "design": POSITIVE})
    assert resp.status_code == 200, resp.text
    return resp.json()["id"]


def _list(client, headers, **params) -> dict:
    query = "&".join(f"{k}={v}" for k, v in params.items())
    resp = client.get(f"/api/designs?{query}" if query else "/api/designs", headers=headers)
    assert resp.status_code == 200, resp.text
    return resp.json()


def test_search_filters_by_name_case_insensitive(client):
    owner = _register(client, "ss_owner")
    login_id = _create(client, owner, "Login Page")
    coupon_id = _create(client, owner, "电商优惠券页")
    detail_id = _create(client, owner, "订单详情页")

    # 不区分大小写的子串匹配
    hit = _list(client, owner, q="login")
    assert [d["id"] for d in hit["designs"]] == [login_id]
    assert hit["total"] == 1  # total 必须跟随 q，否则前端分页会错位

    # 中文子串
    assert {d["id"] for d in _list(client, owner, q="页")["designs"]} == {coupon_id, detail_id}
    zh = _list(client, owner, q="详情")
    assert [d["id"] for d in zh["designs"]] == [detail_id]

    # 无匹配：空列表 + total 0（前端据此显示"没有匹配"而不是"还没有稿件"）
    assert _list(client, owner, q="不存在的稿子") == {"designs": [], "total": 0}

    # 空白 q 视为不过滤（不能因为输入了空格就把列表清空）
    assert _list(client, owner, q="%20%20")["total"] >= 3


def test_search_respects_access_scope(client):
    """搜索不能成为越权探测：别人的私有稿件搜不到。"""
    owner = _register(client, "ss_owner2")
    outsider = _register(client, "ss_outsider2")
    _create(client, owner, "机密-设计稿")
    assert _list(client, owner, q="机密")["total"] == 1
    assert _list(client, outsider, q="机密") == {"designs": [], "total": 0}


def test_search_works_for_shared_workspace_designs(client):
    owner = _register(client, "ss_owner3")
    editor = _register(client, "ss_editor3")
    ws_rows = client.get("/api/workspaces", headers=owner).json()["workspaces"]
    ws_id = next(w["id"] for w in ws_rows if w["role"] == "owner")
    assert (
        client.post(
            f"/api/workspaces/{ws_id}/invites/by-username",
            headers=owner,
            json={"username": "ss_editor3", "role": "editor"},
        ).status_code
        == 200
    )
    design_id = _create(client, owner, "共享-搜索目标")

    body = _list(client, editor, q="搜索目标")
    assert [d["id"] for d in body["designs"]] == [design_id]
    assert body["total"] == 1


def test_sort_whitelist_and_order(client):
    owner = _register(client, "ss_owner4")
    _create(client, owner, "B 稿")
    _create(client, owner, "A 稿")
    _create(client, owner, "C 稿")

    names = [d["name"] for d in _list(client, owner, sort="name_asc")["designs"]]
    assert names == sorted(names)

    # updated_asc 与 updated_desc 互为逆序（同毫秒时用 id 兜底，仍是确定顺序）
    asc = [d["id"] for d in _list(client, owner, sort="updated_asc")["designs"]]
    desc = [d["id"] for d in _list(client, owner, sort="updated_desc")["designs"]]
    assert asc == list(reversed(desc))

    # 默认排序 = updated_desc（既有行为不变）
    assert [d["id"] for d in _list(client, owner)["designs"]] == desc


def test_invalid_sort_is_422(client):
    owner = _register(client, "ss_owner5")
    _create(client, owner, "随便")
    resp = client.get("/api/designs?sort=owner_id", headers=owner)
    assert resp.status_code == 422, resp.text
    assert "sort" in resp.json()["detail"]
