"""T44：资产文件夹（一层目录）——增删改、资产归组、删除文件夹不删资产、越权 404。"""
import io

PNG = b"\x89PNG\r\n\x1a\n" + b"0" * 64


def _register(client, username: str) -> dict[str, str]:
    resp = client.post("/api/auth/register", json={"username": username, "password": f"{username}123"})
    assert resp.status_code == 200, resp.text
    return {"Authorization": f"Bearer {resp.json()['token']}"}


def _upload(client, headers, folder_id: int | None = None, name="a.png") -> int:
    data = {"file": (name, io.BytesIO(PNG), "image/png")}
    if folder_id is not None:
        data["folder_id"] = (None, str(folder_id))
    resp = client.post("/api/images", files=data, headers=headers)
    assert resp.status_code == 200, resp.text
    return resp.json()["id"]


def _folders(client, headers) -> dict:
    resp = client.get("/api/asset-folders", headers=headers)
    assert resp.status_code == 200, resp.text
    return resp.json()


def _create_folder(client, headers, name: str):
    return client.post("/api/asset-folders", headers=headers, json={"name": name})


def _list(client, headers, folder_id: str | None = None) -> list[dict]:
    url = "/api/images" if folder_id is None else f"/api/images?folder_id={folder_id}"
    resp = client.get(url, headers=headers)
    assert resp.status_code == 200, resp.text
    return resp.json()["images"]


def test_create_list_rename_delete(client):
    alice = _register(client, "fold_alice")
    created = _create_folder(client, alice, "图标")
    assert created.status_code == 200, created.text
    folder_id = created.json()["id"]

    # 重名 409 / 空名 422
    assert _create_folder(client, alice, "图标").status_code == 409
    assert _create_folder(client, alice, "   ").status_code == 422

    body = _folders(client, alice)
    assert [f["name"] for f in body["folders"]] == ["图标"]
    assert body["folders"][0]["count"] == 0
    assert body["ungrouped"] == 0

    renamed = client.patch(f"/api/asset-folders/{folder_id}", headers=alice, json={"name": "图标与插画"})
    assert renamed.status_code == 200 and renamed.json()["name"] == "图标与插画"

    assert client.delete(f"/api/asset-folders/{folder_id}", headers=alice).status_code == 200
    assert _folders(client, alice)["folders"] == []


def test_upload_into_folder_and_filter(client):
    alice = _register(client, "fold_bob")
    folder_id = _create_folder(client, alice, "背景").json()["id"]

    in_folder = _upload(client, alice, folder_id=folder_id, name="bg.png")
    ungrouped = _upload(client, alice, name="loose.png")

    assert [i["id"] for i in _list(client, alice, str(folder_id))] == [in_folder]
    assert [i["id"] for i in _list(client, alice, "none")] == [ungrouped]
    assert {i["id"] for i in _list(client, alice)} == {in_folder, ungrouped}
    assert [f["count"] for f in _folders(client, alice)["folders"]] == [1]
    assert _folders(client, alice)["ungrouped"] == 1

    # 非法 folder_id
    assert client.get("/api/images?folder_id=abc", headers=alice).status_code == 422


def test_usage_stays_account_wide_when_filtering_by_folder(client):
    """配额是**账号级**的（上传校验按 owner 求和），列表里的"已用"也必须按账号算。

    否则在文件夹里看到的是"这个文件夹才 72 字节、还早着呢"，一上传却报"容量已达上限"——
    页面数字和服务端判定互相打脸。
    """
    alice = _register(client, "fold_usage")
    folder_id = _create_folder(client, alice, "图标").json()["id"]
    _upload(client, alice, folder_id=folder_id, name="in.png")
    _upload(client, alice, name="loose.png")
    per_image = len(PNG)

    scoped = client.get(f"/api/images?folder_id={folder_id}", headers=alice).json()
    assert len(scoped["images"]) == 1  # 列表按文件夹过滤
    assert scoped["used_count"] == 2  # 但用量（数量/字节）不跟着过滤
    assert scoped["used_bytes"] == 2 * per_image
    assert scoped["limit_count"] == 50 and scoped["limit_bytes"] == 20 * 1024 * 1024

    whole = client.get("/api/images", headers=alice).json()
    assert whole["used_count"] == 2 and whole["used_bytes"] == 2 * per_image


def test_move_asset_between_folders(client):
    alice = _register(client, "fold_carol")
    first = _create_folder(client, alice, "A").json()["id"]
    second = _create_folder(client, alice, "B").json()["id"]
    image_id = _upload(client, alice, folder_id=first)

    moved = client.patch(f"/api/images/{image_id}/folder", headers=alice, json={"folder_id": second})
    assert moved.status_code == 200 and moved.json()["folder_id"] == second
    assert [i["id"] for i in _list(client, alice, str(first))] == []
    assert [i["id"] for i in _list(client, alice, str(second))] == [image_id]

    # 移出到未分组
    assert client.patch(f"/api/images/{image_id}/folder", headers=alice, json={"folder_id": None}).status_code == 200
    assert [i["id"] for i in _list(client, alice, str(second))] == []
    assert [i["id"] for i in _list(client, alice, "none")] == [image_id]


def test_delete_folder_keeps_assets(client):
    alice = _register(client, "fold_dave")
    folder_id = _create_folder(client, alice, "临时").json()["id"]
    image_id = _upload(client, alice, folder_id=folder_id)

    resp = client.delete(f"/api/asset-folders/{folder_id}", headers=alice)
    assert resp.status_code == 200
    assert resp.json()["moved_to_ungrouped"] == 1  # 资产没被删，只回落未分组
    assert [i["id"] for i in _list(client, alice, "none")] == [image_id]
    assert client.get(f"/api/images/{image_id}", headers=alice).status_code == 200


def test_other_users_folders_are_invisible(client):
    alice = _register(client, "fold_erin")
    bob = _register(client, "fold_frank")
    bob_folder = _create_folder(client, bob, "别人的目录").json()["id"]
    bob_image = _upload(client, bob, folder_id=bob_folder)

    # 我的列表里看不到别人的文件夹/资产
    assert _folders(client, alice)["folders"] == []
    assert _folders(client, alice)["ungrouped"] == 0
    assert _list(client, alice) == []
    # 他人的文件夹：改名/删除/查询/移入 一律 404（不泄漏存在性）
    assert client.patch(f"/api/asset-folders/{bob_folder}", headers=alice, json={"name": "x"}).status_code == 404
    assert client.delete(f"/api/asset-folders/{bob_folder}", headers=alice).status_code == 404
    assert client.get(f"/api/images?folder_id={bob_folder}", headers=alice).status_code == 404

    # 上传到他人文件夹 → 404（且不留下孤儿文件：校验在落盘之前）
    resp = client.post(
        "/api/images",
        files={"file": ("a.png", io.BytesIO(PNG), "image/png")},
        data={"folder_id": str(bob_folder)},
        headers=alice,
    )
    assert resp.status_code == 404, resp.text

    # 移动他人的资产 / 移入他人的文件夹 → 404
    assert client.patch(f"/api/images/{bob_image}/folder", headers=alice, json={"folder_id": None}).status_code == 404
    alice_folder = _create_folder(client, alice, "我的目录").json()["id"]
    alice_image = _upload(client, alice)
    assert (
        client.patch(f"/api/images/{alice_image}/folder", headers=alice, json={"folder_id": bob_folder}).status_code
        == 404
    )
    assert (
        client.patch(f"/api/images/{alice_image}/folder", headers=alice, json={"folder_id": alice_folder}).status_code
        == 200
    )
