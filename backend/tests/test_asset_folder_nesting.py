"""文件夹多层目录（2026-09-16）：建子目录、移动父级、防环、深度上限、删除"内容上提一层"。"""
import io

PNG = b"\x89PNG\r\n\x1a\n" + b"0" * 64


def _register(client, username: str) -> dict[str, str]:
    resp = client.post("/api/auth/register", json={"username": username, "password": f"{username}123"})
    assert resp.status_code == 200, resp.text
    return {"Authorization": f"Bearer {resp.json()['token']}"}


def _folder(client, headers, name: str, parent_id: int | None = None):
    body: dict = {"name": name}
    if parent_id is not None:
        body["parent_id"] = parent_id
    return client.post("/api/asset-folders", headers=headers, json=body)


def _tree(client, headers) -> dict[int, int | None]:
    """{folder_id: parent_id}"""
    rows = client.get("/api/asset-folders", headers=headers).json()["folders"]
    return {f["id"]: f["parent_id"] for f in rows}


def _upload(client, headers, folder_id: int | None = None) -> int:
    data: dict = {"file": ("a.png", io.BytesIO(PNG), "image/png")}
    if folder_id is not None:
        data["folder_id"] = (None, str(folder_id))
    resp = client.post("/api/images", files=data, headers=headers)
    assert resp.status_code == 200, resp.text
    return resp.json()["id"]


def test_create_nested_and_list_returns_parent(client):
    alice = _register(client, "nest_alice")
    top = _folder(client, alice, "素材").json()["id"]
    child = _folder(client, alice, "图标", parent_id=top).json()
    assert child["parent_id"] == top
    assert _tree(client, alice) == {top: None, child["id"]: top}


def test_move_folder_between_parents(client):
    alice = _register(client, "nest_bob")
    a = _folder(client, alice, "A").json()["id"]
    b = _folder(client, alice, "B").json()["id"]
    target = _folder(client, alice, "B 的子目录", parent_id=b).json()["id"]

    moved = client.patch(f"/api/asset-folders/{target}/parent", headers=alice, json={"parent_id": a})
    assert moved.status_code == 200, moved.text
    assert _tree(client, alice)[target] == a

    # 移回顶层
    assert client.patch(f"/api/asset-folders/{target}/parent", headers=alice, json={"parent_id": None}).status_code == 200
    assert _tree(client, alice)[target] is None


def test_cycle_and_self_are_rejected(client):
    alice = _register(client, "nest_carol")
    top = _folder(client, alice, "顶层").json()["id"]
    mid = _folder(client, alice, "中层", parent_id=top).json()["id"]
    leaf = _folder(client, alice, "底层", parent_id=mid).json()["id"]

    # 移到自己里面 / 移进自己的后代 → 422（否则树成环，遍历会死循环）
    assert client.patch(f"/api/asset-folders/{top}/parent", headers=alice, json={"parent_id": top}).status_code == 422
    assert client.patch(f"/api/asset-folders/{top}/parent", headers=alice, json={"parent_id": leaf}).status_code == 422
    # 树没被改动
    assert _tree(client, alice) == {top: None, mid: top, leaf: mid}


def test_depth_limit(client):
    alice = _register(client, "nest_dave")
    l1 = _folder(client, alice, "L1").json()["id"]
    l2 = _folder(client, alice, "L2", parent_id=l1).json()["id"]
    l3 = _folder(client, alice, "L3", parent_id=l2).json()["id"]

    # 第四层：拒绝（上限 3）
    denied = _folder(client, alice, "L4", parent_id=l3)
    assert denied.status_code == 422, denied.text
    assert "层级" in denied.json()["detail"]
    # 把一棵子树搬到深层也要算总深度：L1 子树高度 3，搬到 L2 会到第 4 层 → 拒绝
    assert client.patch(f"/api/asset-folders/{l1}/parent", headers=alice, json={"parent_id": l2}).status_code == 422


def test_delete_middle_folder_lifts_children_and_assets(client):
    """删中间层：资产与子目录都上提一层——不删任何东西，也不留孤儿。"""
    alice = _register(client, "nest_erin")
    top = _folder(client, alice, "顶层").json()["id"]
    mid = _folder(client, alice, "中层", parent_id=top).json()["id"]
    leaf = _folder(client, alice, "底层", parent_id=mid).json()["id"]
    asset = _upload(client, alice, folder_id=mid)

    resp = client.delete(f"/api/asset-folders/{mid}", headers=alice)
    assert resp.status_code == 200, resp.text
    assert resp.json()["children_lifted"] == 1

    tree = _tree(client, alice)
    assert mid not in tree  # 被删
    assert tree[leaf] == top  # 子目录上提到顶层
    # 资产上提到顶层（不再是"未分组"）
    in_top = [i["id"] for i in client.get(f"/api/images?folder_id={top}", headers=alice).json()["images"]]
    assert in_top == [asset]
    # 资产本身还在
    assert client.get(f"/api/images/{asset}", headers=alice).status_code == 200


def test_other_peoples_folders_are_not_valid_parents(client):
    alice = _register(client, "nest_frank")
    bob = _register(client, "nest_grace")
    bob_folder = _folder(client, bob, "别人的目录").json()["id"]
    mine = _folder(client, alice, "我的目录").json()["id"]

    assert _folder(client, alice, "想塞进别人目录", parent_id=bob_folder).status_code == 404
    assert client.patch(f"/api/asset-folders/{mine}/parent", headers=alice, json={"parent_id": bob_folder}).status_code == 404
