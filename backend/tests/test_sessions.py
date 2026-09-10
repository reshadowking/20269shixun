"""缺陷 4 会话隔离：会话 CRUD / 消息 / Agent 状态 / 工具调用记账 / 跨会话拒绝。

存储：PostgreSQL（chat_sessions / chat_messages / session_tool_calls），owner 校验与
路径-声明一致性校验在服务端强制，绕过 UI 直接构造请求同样被拒。
测试库跨用例共享，故每个用例使用独立会话 key。
"""
from uuid import uuid4

from app.models import User
from app.security import create_token, hash_password


def _uniq(tag: str) -> str:
    """测试库跨用例共享：每个用例独立会话 key，避免数据互相污染。"""
    return f"s-{tag}-{uuid4().hex[:8]}"


def _second_user_headers(client) -> dict:
    """直插第二个用户（无注册接口）并签发 token，用于 owner 隔离验证。"""
    from app.db import SessionLocal

    db = SessionLocal()
    try:
        if db.query(User).filter(User.username == "other").first() is None:
            db.add(User(username="other", password_hash=hash_password("other123")))
            db.commit()
    finally:
        db.close()
    return {"Authorization": f"Bearer {create_token('other')}"}


def _create(client, headers, key: str, title: str | None = None, design_id: int | None = None):
    body: dict = {"session_key": key}
    if title is not None:
        body["title"] = title
    if design_id is not None:
        body["design_id"] = design_id
    return client.post("/api/sessions", json=body, headers=headers)


def _append(client, headers, key: str, messages: list[dict]):
    return client.post(f"/api/sessions/{key}/messages", json={"messages": messages}, headers=headers)


class TestSessionCrud:
    def test_create_is_idempotent_and_lists_meta_only(self, client, auth_headers):
        key = _uniq("idem")
        r1 = _create(client, auth_headers, key, title="会话 A")
        assert r1.status_code == 200
        assert r1.json()["created"] is True
        r2 = _create(client, auth_headers, key, title="改个名不该生效")
        assert r2.status_code == 200
        assert r2.json()["created"] is False
        assert r2.json()["session_id"] == key
        assert r2.json()["title"] == "会话 A"  # 幂等：已存在则原样返回，不覆盖

        lst = client.get("/api/sessions?limit=100", headers=auth_headers).json()
        assert lst["total"] >= 1
        meta = next(s for s in lst["sessions"] if s["session_id"] == key)
        assert set(meta) == {"session_id", "title", "design_id", "created_at", "updated_at"}  # 仅元信息
        assert "messages" not in meta and "agent_state" not in meta

    def test_get_detail_carries_agent_state(self, client, auth_headers):
        key = _uniq("state")
        _create(client, auth_headers, key)
        client.post(
            f"/api/sessions/{key}/messages",
            json={"messages": [], "agent_state": {"lastPrompt": "做个登录页"}},
            headers=auth_headers,
        )
        detail = client.get(f"/api/sessions/{key}", headers=auth_headers).json()
        assert detail["agent_state"] == {"lastPrompt": "做个登录页"}

    def test_patch_title_and_delete(self, client, auth_headers):
        key = _uniq("patch")
        _create(client, auth_headers, key)
        patched = client.patch(f"/api/sessions/{key}", json={"title": "改名了"}, headers=auth_headers)
        assert patched.json()["title"] == "改名了"
        assert client.delete(f"/api/sessions/{key}", headers=auth_headers).status_code == 200
        assert client.get(f"/api/sessions/{key}", headers=auth_headers).status_code == 404

    def test_unknown_session_404(self, client, auth_headers):
        assert client.get("/api/sessions/s-nope-not-exists", headers=auth_headers).status_code == 404

    def test_requires_auth(self, client):
        assert client.get("/api/sessions").status_code == 401
        assert client.post("/api/sessions", json={"session_key": "s-unauth"}).status_code == 401


class TestMessagesAndIsolation:
    def test_append_and_read_messages_scoped_to_session(self, client, auth_headers):
        key_a, key_b = _uniq("ra"), _uniq("rb")
        _create(client, auth_headers, key_a)
        _create(client, auth_headers, key_b)
        _append(client, auth_headers, key_a, [{"role": "user", "text": "A 的问题"}])
        _append(client, auth_headers, key_b, [{"role": "user", "text": "B 的问题"}])

        a = client.get(f"/api/sessions/{key_a}/messages", headers=auth_headers).json()["messages"]
        b = client.get(f"/api/sessions/{key_b}/messages", headers=auth_headers).json()["messages"]
        assert [m["text"] for m in a] == ["A 的问题"]
        assert [m["text"] for m in b] == ["B 的问题"]
        assert not {m["id"] for m in a} & {m["id"] for m in b}

    def test_clear_only_affects_target_session(self, client, auth_headers):
        """DoD ①：清空会话 A 后，会话 B 的消息与 Agent 状态完好。"""
        key_a, key_b = _uniq("ca"), _uniq("cb")
        _create(client, auth_headers, key_a)
        _create(client, auth_headers, key_b)
        _append(client, auth_headers, key_a, [{"role": "user", "text": "A1"}])
        _append(client, auth_headers, key_b, [{"role": "user", "text": "B1"}, {"role": "assistant", "text": "B2"}])
        client.post(
            f"/api/sessions/{key_b}/messages",
            json={"messages": [], "agent_state": {"lastPrompt": "B 的上下文"}},
            headers=auth_headers,
        )

        assert client.post(f"/api/sessions/{key_a}/clear", headers=auth_headers).status_code == 200

        assert client.get(f"/api/sessions/{key_a}/messages", headers=auth_headers).json()["messages"] == []
        assert client.get(f"/api/sessions/{key_a}", headers=auth_headers).json()["agent_state"] == {}
        b_msgs = client.get(f"/api/sessions/{key_b}/messages", headers=auth_headers).json()["messages"]
        assert [m["text"] for m in b_msgs] == ["B1", "B2"]
        assert client.get(f"/api/sessions/{key_b}", headers=auth_headers).json()["agent_state"] == {"lastPrompt": "B 的上下文"}

    def test_new_session_starts_empty(self, client, auth_headers):
        """DoD ②：新建会话消息列表为空，不含任何其他会话历史。"""
        key_a, key_b = _uniq("na"), _uniq("nb")
        _create(client, auth_headers, key_a)
        _append(client, auth_headers, key_a, [{"role": "user", "text": "旧会话内容"}])
        _create(client, auth_headers, key_b)
        assert client.get(f"/api/sessions/{key_b}/messages", headers=auth_headers).json()["messages"] == []
        assert client.get(f"/api/sessions/{key_b}", headers=auth_headers).json()["agent_state"] == {}

    def test_mismatched_session_claim_rejected(self, client, auth_headers):
        """DoD ③：用会话 B 的 id 携带会话 A 的声明写入 → 422（跨会话写入被拒绝）。"""
        key_a, key_b = _uniq("ma"), _uniq("mb")
        _create(client, auth_headers, key_a)
        _create(client, auth_headers, key_b)
        resp = client.post(
            f"/api/sessions/{key_b}/messages",
            json={"session_id": key_a, "messages": [{"role": "user", "text": "串写"}]},
            headers=auth_headers,
        )
        assert resp.status_code == 422
        assert "跨会话" in resp.json()["detail"]
        assert client.get(f"/api/sessions/{key_b}/messages", headers=auth_headers).json()["messages"] == []

    def test_context_window_only_from_target_session(self, client, auth_headers):
        """DoD ③/④：Agent 上下文只可能来自本会话（消息集合 ⊆ 该会话）。"""
        key_a, key_b = _uniq("xa"), _uniq("xb")
        _create(client, auth_headers, key_a)
        _create(client, auth_headers, key_b)
        _append(client, auth_headers, key_a, [{"role": "user", "text": f"A{i}"} for i in range(3)])
        _append(client, auth_headers, key_b, [{"role": "user", "text": "B1"}, {"role": "assistant", "text": "B2"}])

        ctx = client.get(f"/api/sessions/{key_b}/context?max_turns=10", headers=auth_headers).json()
        assert [m["text"] for m in ctx["messages"]] == ["B1", "B2"]
        assert all(m["session_id"] == key_b for m in ctx["messages"])

        # 窗口截断：只保留最近 max_turns*2 条
        ctx2 = client.get(f"/api/sessions/{key_b}/context?max_turns=1", headers=auth_headers).json()
        assert [m["text"] for m in ctx2["messages"]] == ["B1", "B2"]

    def test_message_cap_prunes_oldest(self, client, auth_headers):
        """保留上限 200 条：超出裁旧（保留最新）。"""
        key = _uniq("cap")
        _create(client, auth_headers, key)
        for i in range(0, 210, 30):
            _append(client, auth_headers, key, [{"role": "user", "text": f"m{i + j}"} for j in range(30)])
        msgs = client.get(f"/api/sessions/{key}/messages?limit=500", headers=auth_headers).json()["messages"]
        assert len(msgs) == 200
        assert msgs[-1]["text"] == "m209"  # 保留最新
        assert msgs[0]["text"] == "m10"  # 最旧的 10 条被裁掉

    def test_title_autofill_from_first_user_message(self, client, auth_headers):
        key = _uniq("title")
        _create(client, auth_headers, key)
        _append(client, auth_headers, key, [{"role": "user", "text": "帮我设计一个电商优惠券领取页，红色调"}])
        detail = client.get(f"/api/sessions/{key}", headers=auth_headers).json()
        assert detail["title"].startswith("帮我设计一个电商优惠券")
        assert len(detail["title"]) <= 21


class TestToolCallsAndOwnerIsolation:
    def test_tool_call_ledger_bound_to_session(self, client, auth_headers):
        key_a, key_b = _uniq("ta"), _uniq("tb")
        _create(client, auth_headers, key_a)
        _create(client, auth_headers, key_b)
        resp = client.post(f"/api/sessions/{key_a}/tool-calls", json={"kind": "generate", "ok": True}, headers=auth_headers)
        assert resp.status_code == 200
        calls_a = client.get(f"/api/sessions/{key_a}/tool-calls", headers=auth_headers).json()["tool_calls"]
        calls_b = client.get(f"/api/sessions/{key_b}/tool-calls", headers=auth_headers).json()["tool_calls"]
        assert [c["kind"] for c in calls_a] == ["generate"]
        assert calls_a[0]["ok"] is True
        assert calls_b == []

    def test_tool_call_rejects_mismatched_session(self, client, auth_headers):
        key_a, key_b = _uniq("ta2"), _uniq("tb2")
        _create(client, auth_headers, key_a)
        _create(client, auth_headers, key_b)
        resp = client.post(
            f"/api/sessions/{key_b}/tool-calls",
            json={"session_id": key_a, "kind": "generate", "ok": True},
            headers=auth_headers,
        )
        assert resp.status_code == 422
        assert "跨会话" in resp.json()["detail"]

    def test_other_user_session_is_404(self, client, auth_headers):
        """owner 隔离：他人会话既读不到也写不了（404，不泄漏存在性）。"""
        key = _uniq("priv")
        _create(client, auth_headers, key)
        _append(client, auth_headers, key, [{"role": "user", "text": "私密内容"}])
        other = _second_user_headers(client)

        assert client.get(f"/api/sessions/{key}", headers=other).status_code == 404
        assert client.get(f"/api/sessions/{key}/messages", headers=other).status_code == 404
        assert client.post(f"/api/sessions/{key}/messages", json={"messages": [{"role": "user", "text": "x"}]}, headers=other).status_code == 404
        assert client.delete(f"/api/sessions/{key}", headers=other).status_code == 404
        assert client.post(f"/api/sessions/{key}/clear", headers=other).status_code == 404
        assert key not in [s["session_id"] for s in client.get("/api/sessions", headers=other).json()["sessions"]]

        # 原 owner 数据未被影响
        assert [m["text"] for m in client.get(f"/api/sessions/{key}/messages", headers=auth_headers).json()["messages"]] == ["私密内容"]

    def test_same_key_different_owner_is_independent(self, client, auth_headers):
        """同一 session_key 在不同用户下是两条独立会话（唯一约束含 owner）。"""
        key = _uniq("share")
        _create(client, auth_headers, key, title="demo 的会话")
        other = _second_user_headers(client)
        resp = _create(client, other, key, title="other 的会话")
        assert resp.status_code == 200
        assert resp.json()["title"] == "other 的会话"
        assert client.get(f"/api/sessions/{key}", headers=auth_headers).json()["title"] == "demo 的会话"


class TestSessionValidation:
    def test_invalid_session_key_rejected(self, client, auth_headers):
        resp = client.post("/api/sessions", json={"session_key": "bad key with spaces!"}, headers=auth_headers)
        assert resp.status_code == 422

    def test_invalid_role_rejected(self, client, auth_headers):
        key = _uniq("role")
        _create(client, auth_headers, key)
        resp = _append(client, auth_headers, key, [{"role": "system", "text": "x"}])
        assert resp.status_code == 422

    def test_design_binding_requires_ownership(self, client, auth_headers):
        """绑定 design_id 时会校验归属（他人/不存在的设计不可绑定）。"""
        did = client.post(
            "/api/designs", json={"name": "会话绑定", "design": {"id": "root", "type": "frame"}}, headers=auth_headers
        ).json()["id"]
        assert _create(client, auth_headers, _uniq("bind"), design_id=did).status_code == 200
        assert _create(client, auth_headers, _uniq("bindbad"), design_id=999999).status_code == 404


class TestSessionDesignBinding:
    def test_bind_design_after_save(self, client, auth_headers):
        """缺陷 4：首次保存为正式设计后，会话可绑定该设计（并校验归属）。"""
        key = _uniq("bind")
        _create(client, auth_headers, key)
        assert client.get(f"/api/sessions/{key}", headers=auth_headers).json()["design_id"] is None

        did = client.post(
            "/api/designs", json={"name": "绑定用", "design": {"id": "root", "type": "frame"}}, headers=auth_headers
        ).json()["id"]
        resp = client.patch(f"/api/sessions/{key}", json={"design_id": did}, headers=auth_headers)
        assert resp.status_code == 200
        assert resp.json()["design_id"] == did

        # 标题更新仍可用（不传 design_id 不影响绑定）
        assert client.patch(f"/api/sessions/{key}", json={"title": "改名"}, headers=auth_headers).json()["title"] == "改名"
        assert client.get(f"/api/sessions/{key}", headers=auth_headers).json()["design_id"] == did

    def test_bind_foreign_or_missing_design_rejected(self, client, auth_headers):
        key = _uniq("bindbad")
        _create(client, auth_headers, key)
        assert client.patch(f"/api/sessions/{key}", json={"design_id": 999999}, headers=auth_headers).status_code == 404
