"""T4 批1 锁定期 AI 落地闸门：apply_locked_edit 校验器 + /api/apply-locked-edit + 锁状态持久化。

核心验收（缺陷 3 写入门层）：绕过 UI 直接构造请求也拦得住——锁状态由服务端按
session_key 查（B 决策），闸门拒绝结构/文案/布局变化，放行预置效果，丢弃非预置值。
语义（任务卡 §4.1）：返回 {ok, design, changed_ids, dropped, reason}；拒绝 = ok:false
+ reason（HTTP 仍 200，前端据此不改画布并提示）；非法请求体/会话不存在才 4xx。
"""
import copy

import pytest

from app.services.beautify import apply_locked_edit

SHADOW_PRESET = "0 4px 12px rgba(29,33,41,0.10)"
SHADOW_ORIG = "0 1px 2px rgba(29,33,41,0.06)"


def tree() -> dict:
    return {
        "id": "root",
        "type": "frame",
        "style": {"layout": "column", "gap": 8},
        "children": [
            {"id": "t1", "type": "text", "props": {"text": "标题"}, "style": {"color": "text-primary"}},
            {
                "id": "b1",
                "type": "component",
                "componentType": "button",
                "props": {"text": "按钮"},
                "style": {"width": 160},
            },
        ],
    }


def with_style(base: dict, node_id: str, **style) -> dict:
    """返回一棵新树：指定节点 style 追加/覆盖给定键（其余不动）。"""
    t = copy.deepcopy(base)

    def walk(node: dict) -> None:
        if node.get("id") == node_id:
            node.setdefault("style", {}).update(style)
            return
        for c in node.get("children") or []:
            walk(c)

    walk(t)
    return t


# ---------- 校验器（服务层） ----------


def test_合法效果变更通过且返回变更节点_id():
    before = tree()
    after = with_style(before, "b1", shadow=SHADOW_PRESET)
    result = apply_locked_edit(before, after)
    assert result.ok is True
    assert result.changed_ids == ["b1"]
    assert result.dropped == []
    assert result.design["children"][1]["style"]["shadow"] == SHADOW_PRESET
    # 非效果键原样保留
    assert result.design["children"][1]["style"]["width"] == 160


def test_结构变更被拒_新增节点():
    before = tree()
    after = copy.deepcopy(before)
    after["children"].append({"id": "x1", "type": "text", "props": {"text": "新"}})
    result = apply_locked_edit(before, after)
    assert result.ok is False
    assert "结构" in result.reason


def test_结构变更被拒_删除节点():
    before = tree()
    after = copy.deepcopy(before)
    after["children"] = before["children"][:1]
    result = apply_locked_edit(before, after)
    assert result.ok is False
    assert "结构" in result.reason


def test_结构变更被拒_兄弟换序():
    before = tree()
    after = copy.deepcopy(before)
    after["children"] = list(reversed(before["children"]))
    result = apply_locked_edit(before, after)
    assert result.ok is False
    assert "结构" in result.reason


def test_结构变更被拒_改父级不改前序_携带路径比对():
    """改父级（re-parent）在先序遍历下 id 序列可能不变，必须逐节点按位置配对才能识别。"""
    before = {
        "id": "root", "type": "frame", "children": [
            {"id": "a", "type": "frame", "children": [{"id": "b", "type": "text"}]},
            {"id": "c", "type": "text"},
        ],
    }
    after = {
        "id": "root", "type": "frame", "children": [
            {"id": "a", "type": "frame", "children": []},
            {"id": "b", "type": "text"},  # b 从 a 的子级挪到根下：先序 a,b,c 不变但结构变了
            {"id": "c", "type": "text"},
        ],
    }
    result = apply_locked_edit(before, after)
    assert result.ok is False
    assert "结构" in result.reason


def test_文案变更被拒():
    before = tree()
    after = copy.deepcopy(before)
    after["children"][0]["props"]["text"] = "改成的新标题"
    result = apply_locked_edit(before, after)
    assert result.ok is False
    assert "文案" in result.reason


def test_布局字段变更被拒_width():
    before = tree()
    after = with_style(before, "b1", width=999)
    result = apply_locked_edit(before, after)
    assert result.ok is False
    assert "布局" in result.reason


def test_布局字段变更被拒_layout():
    before = tree()
    after = copy.deepcopy(before)
    after["style"]["layout"] = "grid"
    result = apply_locked_edit(before, after)
    assert result.ok is False
    assert "布局" in result.reason


def test_拒绝时返回原树_画布语义不变():
    before = tree()
    after = with_style(before, "b1", width=999)
    result = apply_locked_edit(before, after)
    assert result.ok is False
    assert result.design == before


def test_非预置效果值被丢弃并保留原值():
    before = with_style(tree(), "b1", shadow=SHADOW_ORIG)
    after = with_style(before, "b1", shadow="box-shadow: 自创的自由 CSS")
    result = apply_locked_edit(before, after)
    assert result.ok is True  # 丢弃 ≠ 拒绝：其余内容仍落地
    assert result.dropped == ["b1.shadow"]
    assert result.design["children"][1]["style"]["shadow"] == SHADOW_ORIG


def test_移除效果_value_none_视为合法():
    before = with_style(tree(), "b1", shadow=SHADOW_PRESET)
    after = with_style(before, "b1", shadow=None)
    result = apply_locked_edit(before, after)
    assert result.ok is True
    assert "b1" in result.changed_ids
    assert "shadow" not in result.design["children"][1]["style"]


# ---------- 端点（/api/apply-locked-edit + 锁状态读写） ----------


@pytest.fixture()
def locked_session(client, auth_headers):
    """已创建且已锁定的会话。"""
    client.post("/api/sessions", json={"session_key": "s-lock-a"}, headers=auth_headers)
    resp = client.post(
        "/api/sessions/s-lock-a/beautify-lock", json={"locked": True}, headers=auth_headers
    )
    assert resp.status_code == 200
    return auth_headers


def test_锁定态端点拒绝结构变更_绕过UI也拦得住(client, locked_session):
    before = tree()
    after = copy.deepcopy(before)
    after["children"].append({"id": "x1", "type": "text", "props": {"text": "注入"}})
    resp = client.post(
        "/api/apply-locked-edit",
        json={"session_key": "s-lock-a", "before": before, "after": after},
        headers=locked_session,
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["ok"] is False
    assert "结构" in body["reason"]
    # 画布语义：拒绝时返回原树（前端不改画布）
    assert body["design"] == before


def test_锁定态端点放行合法效果(client, locked_session):
    before = tree()
    after = with_style(before, "b1", shadow=SHADOW_PRESET)
    resp = client.post(
        "/api/apply-locked-edit",
        json={"session_key": "s-lock-a", "before": before, "after": after},
        headers=locked_session,
    )
    body = resp.json()
    assert body["ok"] is True
    assert body["changed_ids"] == ["b1"]
    assert body["design"]["children"][1]["style"]["shadow"] == SHADOW_PRESET


def test_未锁定会话不做校验_与改造前等价(client, auth_headers):
    client.post("/api/sessions", json={"session_key": "s-lock-open"}, headers=auth_headers)
    before = tree()
    after = copy.deepcopy(before)
    after["children"][0]["props"]["text"] = "未锁定随便改"
    resp = client.post(
        "/api/apply-locked-edit",
        json={"session_key": "s-lock-open", "before": before, "after": after},
        headers=auth_headers,
    )
    body = resp.json()
    assert body["ok"] is True
    assert body["design"] == after  # 直接落地 after，不做闸门校验


def test_会话不存在不得默认放行(client, auth_headers):
    resp = client.post(
        "/api/apply-locked-edit",
        json={"session_key": "s-no-such", "before": tree(), "after": tree()},
        headers=auth_headers,
    )
    assert resp.status_code == 404


def test_锁状态写入后可读回(client, auth_headers):
    client.post("/api/sessions", json={"session_key": "s-lock-rw"}, headers=auth_headers)
    assert client.get("/api/sessions/s-lock-rw/beautify-lock", headers=auth_headers).json() == {"locked": False}
    client.post("/api/sessions/s-lock-rw/beautify-lock", json={"locked": True}, headers=auth_headers)
    assert client.get("/api/sessions/s-lock-rw/beautify-lock", headers=auth_headers).json() == {"locked": True}
    # 解除锁定同样持久
    client.post("/api/sessions/s-lock-rw/beautify-lock", json={"locked": False}, headers=auth_headers)
    assert client.get("/api/sessions/s-lock-rw/beautify-lock", headers=auth_headers).json() == {"locked": False}


def test_锁状态按会话隔离(client, auth_headers):
    client.post("/api/sessions", json={"session_key": "s-iso-a"}, headers=auth_headers)
    client.post("/api/sessions", json={"session_key": "s-iso-b"}, headers=auth_headers)
    client.post("/api/sessions/s-iso-a/beautify-lock", json={"locked": True}, headers=auth_headers)
    assert client.get("/api/sessions/s-iso-a/beautify-lock", headers=auth_headers).json() == {"locked": True}
    assert client.get("/api/sessions/s-iso-b/beautify-lock", headers=auth_headers).json() == {"locked": False}
    # A 锁定拦截 A 的越权修改；B 未锁定放行 B 的修改
    before, after = tree(), copy.deepcopy(tree())
    after["children"][0]["props"]["text"] = "A 的越权文案"
    resp_a = client.post(
        "/api/apply-locked-edit", json={"session_key": "s-iso-a", "before": before, "after": after}, headers=auth_headers
    )
    assert resp_a.json()["ok"] is False
    resp_b = client.post(
        "/api/apply-locked-edit", json={"session_key": "s-iso-b", "before": before, "after": after}, headers=auth_headers
    )
    assert resp_b.json()["ok"] is True


def test_非法请求体返回4xx而非500(client, locked_session):
    # 缺 after
    assert (
        client.post("/api/apply-locked-edit", json={"session_key": "s-lock-a"}, headers=locked_session).status_code
        == 422
    )
    # after 非 dict
    assert (
        client.post(
            "/api/apply-locked-edit",
            json={"session_key": "s-lock-a", "before": tree(), "after": [1, 2]},
            headers=locked_session,
        ).status_code
        == 422
    )
    # 缺 session_key
    assert (
        client.post(
            "/api/apply-locked-edit", json={"before": tree(), "after": tree()}, headers=locked_session
        ).status_code
        == 422
    )


def test_他人会话的锁不可读写(client, auth_headers):
    """owner 隔离：另一账号看不到/改不了 demo 的锁（404，不泄漏存在性）。"""
    from app.db import SessionLocal
    from app.models import User
    from app.security import create_token, hash_password

    db = SessionLocal()
    try:
        if db.query(User).filter(User.username == "other").first() is None:
            db.add(User(username="other", password_hash=hash_password("other123")))
            db.commit()
    finally:
        db.close()
    other_headers = {"Authorization": f"Bearer {create_token('other')}"}
    # other 无权读写 demo 创建的会话锁
    assert client.get("/api/sessions/s-lock-a/beautify-lock", headers=other_headers).status_code == 404
    assert (
        client.post("/api/sessions/s-lock-a/beautify-lock", json={"locked": False}, headers=other_headers).status_code
        == 404
    )
    # other 也无法把自己的树借 demo 的锁会话过闸
    resp = client.post(
        "/api/apply-locked-edit",
        json={"session_key": "s-lock-a", "before": tree(), "after": tree()},
        headers=other_headers,
    )
    assert resp.status_code == 404


def test_闸门不接受请求体声明_locked字段(client, locked_session):
    """B 决策：锁由服务端查，请求体就算夹带 locked=false 也不能解锁。"""
    before = tree()
    after = copy.deepcopy(before)
    after["children"][0]["props"]["text"] = "夹带 locked 声明的越权"
    resp = client.post(
        "/api/apply-locked-edit",
        json={"session_key": "s-lock-a", "before": before, "after": after, "locked": False},
        headers=locked_session,
    )
    assert resp.json()["ok"] is False  # 额外字段被忽略，服务端仍按会话锁判定
