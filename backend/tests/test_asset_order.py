"""拖拽排序（2026-09-16）：文件夹之间、文件夹内资产的 sort_order 与越权口径。"""
import io

PNG = b"\x89PNG\r\n\x1a\n" + b"0" * 64


def _register(client, username: str) -> dict[str, str]:
    resp = client.post("/api/auth/register", json={"username": username, "password": f"{username}123"})
    assert resp.status_code == 200, resp.text
    return {"Authorization": f"Bearer {resp.json()['token']}"}


def _folder(client, headers, name: str) -> int:
    resp = client.post("/api/asset-folders", headers=headers, json={"name": name})
    assert resp.status_code == 200, resp.text
    return resp.json()["id"]


def _upload(client, headers, folder_id: int | None = None, name="a.png") -> int:
    data: dict = {"file": (name, io.BytesIO(PNG), "image/png")}
    if folder_id is not None:
        data["folder_id"] = (None, str(folder_id))
    resp = client.post("/api/images", files=data, headers=headers)
    assert resp.status_code == 200, resp.text
    return resp.json()["id"]


def _folder_names(client, headers) -> list[str]:
    return [f["name"] for f in client.get("/api/asset-folders", headers=headers).json()["folders"]]


def _asset_ids(client, headers, folder_id: str) -> list[int]:
    return [i["id"] for i in client.get(f"/api/images?folder_id={folder_id}", headers=headers).json()["images"]]


def test_reorder_folders(client):
    alice = _register(client, "ord_alice")
    a = _folder(client, alice, "A")
    b = _folder(client, alice, "B")
    c = _folder(client, alice, "C")
    assert _folder_names(client, alice) == ["A", "B", "C"]  # 默认按创建顺序

    moved = client.patch("/api/asset-folders/order", headers=alice, json={"ids": [c, a, b]})
    assert moved.status_code == 200, moved.text
    assert _folder_names(client, alice) == ["C", "A", "B"]

    # 只重排子集也允许（其余保持原有相对顺序）
    assert client.patch("/api/asset-folders/order", headers=alice, json={"ids": [b]}).status_code == 200
    assert _folder_names(client, alice)[0] == "B"


def test_reorder_assets_within_folder(client):
    alice = _register(client, "ord_bob")
    folder = _folder(client, alice, "素材")
    first = _upload(client, alice, folder, "1.png")
    second = _upload(client, alice, folder, "2.png")
    third = _upload(client, alice, folder, "3.png")
    # 未排序时是"新→旧"（与改造前一致）
    assert _asset_ids(client, alice, str(folder)) == [third, second, first]

    resp = client.patch("/api/images/order", headers=alice, json={"ids": [first, third, second], "folder_id": folder})
    assert resp.status_code == 200, resp.text
    assert _asset_ids(client, alice, str(folder)) == [first, third, second]


def test_reorder_guards(client):
    alice = _register(client, "ord_carol")
    bob = _register(client, "ord_dave")
    folder = _folder(client, alice, "我的目录")
    other_folder = _folder(client, alice, "另一个目录")
    bob_folder = _folder(client, bob, "别人的目录")
    in_folder = _upload(client, alice, folder)
    in_other = _upload(client, alice, other_folder)
    bob_asset = _upload(client, bob, bob_folder)

    # 他人的文件夹 id → 404
    assert client.patch("/api/asset-folders/order", headers=alice, json={"ids": [bob_folder]}).status_code == 404
    # 他人的资产 id → 404
    assert (
        client.patch("/api/images/order", headers=alice, json={"ids": [bob_asset], "folder_id": None}).status_code == 404
    )
    # 目标作用域不匹配（资产不在该文件夹）→ 409，且顺序不变
    mismatch = client.patch(
        "/api/images/order", headers=alice, json={"ids": [in_other], "folder_id": folder}
    )
    assert mismatch.status_code == 409, mismatch.text
    assert _asset_ids(client, alice, str(folder)) == [in_folder]
    # 目标文件夹不是我的 → 404
    assert (
        client.patch("/api/images/order", headers=alice, json={"ids": [in_folder], "folder_id": bob_folder}).status_code
        == 404
    )
    # 空数组 → 422（不静默成功）
    assert client.patch("/api/asset-folders/order", headers=alice, json={"ids": []}).status_code == 422
