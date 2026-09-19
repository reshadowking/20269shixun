"""T52：能力缺口台账——三收集点、净化红线、旁路容错、列宽边界（SQLite 语义）。

测试 DB 是 SQLite（conftest 把 PG_URL 覆盖为 test_ai_native.db）。SQLite **不校验** VARCHAR
长度，所以"截断必须在 Python 层"不是可选项：断言入库值长度 ≤ 列宽，测的是 ai_ledger._fit_gap
这一层（Postgres 上超长会 StringDataRightTruncation 且整批回滚，见 ai_calls 的事故注释）。
VARCHAR(120) 按**字符**计（Postgres 语义），Python 切片按码点——中文字符不会切在多字节中间，
中文边界用例把这一行为钉死。
"""
import logging
from types import SimpleNamespace

from app.db import SessionLocal
from app.models import AiCapabilityGap
from app.services import ai_ledger
from app.services.generate import repair_design


def _rows(session_key: str) -> list[AiCapabilityGap]:
    db = SessionLocal()
    try:
        return list(db.query(AiCapabilityGap).filter(AiCapabilityGap.session_key == session_key).all())
    finally:
        db.close()


# ---- 净化红线（单点 _sanitize_detail）----


class TestSanitize:
    def test_identifier_kept_verbatim(self):
        assert ai_ledger._sanitize_detail("pagination") == "pagination"
        assert ai_ledger._sanitize_detail("props.glass") == "props.glass"
        assert ai_ledger._sanitize_detail("n-c123") == "n-c123"

    def test_non_ascii_key_folded(self):
        """AI 自创中文键名（可能夹带用户意图）→ 折叠为 <non-ascii>，不进 DB。"""
        assert ai_ledger._sanitize_detail("用户备注") == "<non-ascii>"
        assert ai_ledger._sanitize_detail("props.用户备注") == "props.<non-ascii>"
        assert ai_ledger._sanitize_detail("page 分页") == "page<non-ascii>"

    def test_empty_or_only_unsafe_becomes_unspecified(self):
        assert ai_ledger._sanitize_detail("") == "<unspecified>"
        assert ai_ledger._sanitize_detail("-") == "<unspecified>"


# ---- repair_design 的结构化收集（与 degraded 双口径）----


class TestRepairCollection:
    def test_degraded_structured_row(self):
        degraded: list[str] = []
        gap_rows: list[dict] = []
        fixed = repair_design({"id": "n1", "type": "pagination"}, degraded, gap_rows)
        assert fixed["type"] == "frame"
        assert degraded == ["pagination@n1"]  # 外显契约不变
        assert gap_rows == [{"gap_type": "degraded", "detail": "pagination", "node_id": "n1"}]  # 零 @ 解析

    def test_dual_bookkeeping_correspondence(self):
        """防漂移断言：degraded 字符串与结构化行必须一一对应（数量/顺序/内容）。"""
        degraded: list[str] = []
        gap_rows: list[dict] = []
        tree = {
            "id": "r",
            "type": "frame",
            "children": [
                {"id": "a", "type": "pagination"},
                {"id": "b", "type": "component", "componentType": "dialog"},
            ],
        }
        repair_design(tree, degraded, gap_rows)
        degraded_rows = [g for g in gap_rows if g["gap_type"] == "degraded"]
        assert len(degraded) == len(degraded_rows) == 2
        assert [d.split("@")[1] for d in degraded] == [g["node_id"] for g in degraded_rows]
        assert [d.split("@")[0] for d in degraded] == [g["detail"] for g in degraded_rows]

    def test_unknown_node_key_collected(self):
        gap_rows: list[dict] = []
        fixed = repair_design({"id": "n2", "type": "frame", "content": "多余键"}, gap_rows=gap_rows)
        assert "content" not in fixed
        assert {"gap_type": "unknown_prop", "detail": "content", "node_id": "n2"} in gap_rows

    def test_unknown_props_field_collected_but_declared_not(self):
        gap_rows: list[dict] = []
        repair_design(
            {"id": "n3", "type": "component", "componentType": "card", "props": {"title": "t", "glass": True}},
            gap_rows=gap_rows,
        )
        assert {"gap_type": "unknown_prop", "detail": "props.glass", "node_id": "n3"} in gap_rows
        assert all(g["detail"] != "props.title" for g in gap_rows)  # 声明过的字段不误报

    def test_name_common_key_not_flagged(self):
        """公共键 name（图层树重命名）+ icon 声明的 props.name 都不该进台账。"""
        gap_rows: list[dict] = []
        repair_design(
            {
                "id": "r",
                "type": "frame",
                "children": [
                    {"id": "c1", "type": "component", "componentType": "card", "props": {"name": "我的卡片"}},
                    {"id": "c2", "type": "component", "componentType": "icon", "props": {"name": "star"}},
                ],
            },
            gap_rows=gap_rows,
        )
        assert not gap_rows

    def test_group_normalization_is_not_a_gap(self):
        """基元开放决策：group→frame 归一化不是能力缺口（能力存在，只是写法归一）。"""
        gap_rows: list[dict] = []
        repair_design({"id": "g", "type": "group"}, gap_rows=gap_rows)
        assert not gap_rows

    def test_children_recursion_uses_child_node_id(self):
        gap_rows: list[dict] = []
        repair_design(
            {"id": "r", "type": "frame", "children": [{"id": "kid", "type": "frame", "content": "x"}]},
            gap_rows=gap_rows,
        )
        assert gap_rows == [{"gap_type": "unknown_prop", "detail": "content", "node_id": "kid"}]

    def test_no_accumulator_still_works(self):
        fixed = repair_design({"id": "x", "type": "pagination"})
        assert fixed["type"] == "frame"


# ---- 落库（列宽边界：SQLite 语义，Python 层截断）----


class TestRecord:
    def test_writes_rows_with_sanitize(self, client):
        written = ai_ledger.record_capability_gaps(
            [
                {"gap_type": "degraded", "detail": "pagination", "node_id": "p1", "llm_model": "kimi", "prompt_version": "abcd1234efgh", "profile_id": "kimi", "api_format": "openai"},
                {"gap_type": "unknown_prop", "detail": "props.用户备注", "node_id": "n9"},
            ],
            session_key="s-gaps-write",
            user="demo",
        )
        assert written == 2
        rows = _rows("s-gaps-write")
        assert len(rows) == 2
        clean = next(r for r in rows if r.gap_type == "degraded")
        assert (clean.detail, clean.node_id, clean.llm_model, clean.user) == ("pagination", "p1", "kimi", "demo")
        leaked = next(r for r in rows if r.gap_type == "unknown_prop")
        assert leaked.detail == "props.<non-ascii>"  # 中文键名没进 DB

    def test_ops_row_empty_node_id_stays_empty(self, client):
        ai_ledger.record_capability_gaps(
            [{"gap_type": "ops_rejected", "detail": "ops:insert", "node_id": ""}], session_key="s-gaps-ops-empty"
        )
        assert _rows("s-gaps-ops-empty")[0].node_id == ""

    def test_empty_input_noop(self, client):
        assert ai_ledger.record_capability_gaps(None, session_key="s-gaps-none") == 0
        assert _rows("s-gaps-none") == []

    def test_oversized_detail_truncated_to_column_width(self, client, caplog):
        """列宽边界：SQLite 不校验长度，截断必须在 Python 层——=列宽/+1/+2 全部落库且 ≤120；
        纯中文 detail 先被净化折叠（<non-ascii>），原文只留日志。"""
        limit = ai_ledger._GAP_COLUMN_LIMITS["detail"]
        assert limit == 120
        cases = {
            "exact": ("a" * limit, lambda d: len(d) == limit),
            "over1": ("a" * (limit + 1), lambda d: len(d) == limit),
            "over2": ("a" * (limit + 2), lambda d: len(d) == limit),
            "cjk": ("组" * (limit + 1), lambda d: d == "<non-ascii>"),  # 净化先于截断：整体折叠
            "mixed": ("a" * (limit - 1) + "分页", lambda d: len(d) == limit),  # 截断不切多字节中间
        }
        gaps = [{"gap_type": "unknown_prop", "detail": v, "node_id": f"n{i}"} for i, (v, _) in enumerate(cases.values())]
        with caplog.at_level(logging.WARNING):
            assert ai_ledger.record_capability_gaps(gaps, session_key="s-gaps-width") == len(cases)
        assert any("超长" in r.message for r in caplog.records)  # 被截断的内容必须留 warn 日志
        rows = {r.node_id: r for r in _rows("s-gaps-width")}
        for i, (name, (_, check)) in enumerate(cases.items()):
            assert len(rows[f"n{i}"].detail) <= limit, name
            assert check(rows[f"n{i}"].detail), name


# ---- 旁路容错（两形态：连接失败 / 写入失败）----


class _BoomSession:
    """写入阶段失败的假会话：add_all 成功、commit 抛异常（比"连接不上"更危险的形态——
    事务已开、连接已占；若 close 不在 finally 里执行，连接池会被耗尽）。"""

    def __init__(self):
        self.closed = False

    def add_all(self, rows):
        pass

    def commit(self):
        raise RuntimeError("模拟约束冲突")

    def close(self):
        self.closed = True


class TestBypass:
    def test_connect_failure_does_not_break(self, monkeypatch):
        def boom():
            raise RuntimeError("数据库不可达")

        monkeypatch.setattr(ai_ledger, "SessionLocal", boom)
        assert ai_ledger.record_capability_gaps([{"gap_type": "degraded", "detail": "x"}], session_key="s-x") == 0

    def test_write_failure_releases_session_and_pool_survives(self, client, monkeypatch):
        """写入阶段失败：异常吞掉 + close 在 finally 里执行（连接归还）；
        随后一次**真实**写入成功，证明连接没有被占死。"""
        fake = _BoomSession()
        real_session_local = ai_ledger.SessionLocal
        state = {"calls": 0}

        def flaky_session_local():
            state["calls"] += 1
            if state["calls"] == 1:
                return fake  # 第一次：写入阶段失败
            return real_session_local()  # 之后：真实会话

        monkeypatch.setattr(ai_ledger, "SessionLocal", flaky_session_local)
        assert ai_ledger.record_capability_gaps([{"gap_type": "degraded", "detail": "x"}], session_key="s-y") == 0
        assert fake.closed, "commit 抛异常后连接必须被归还（close 在 finally 里）"

        assert ai_ledger.record_capability_gaps([{"gap_type": "degraded", "detail": "ok"}], session_key="s-y-real") == 1
        assert any(r.detail == "ok" for r in _rows("s-y-real"))


# ---- 集成：真实生成链路（fake OpenAI，零网络；复用 test_ai_ledger 的注入范式）----


class _FakeCompletions:
    def __init__(self, content: str):
        self.content = content

    def create(self, **kwargs):
        return SimpleNamespace(
            model="fake-model",
            usage=SimpleNamespace(prompt_tokens=1, completion_tokens=1),
            choices=[SimpleNamespace(message=SimpleNamespace(content=self.content), finish_reason="stop")],
        )


def _fake_openai(monkeypatch, content: str) -> None:
    from app.services import llm as llm_module

    class FakeOpenAI:
        def __init__(self, **_kwargs):
            self.chat = SimpleNamespace(completions=_FakeCompletions(content))

    monkeypatch.setattr(llm_module, "OpenAI", FakeOpenAI)
    monkeypatch.setattr(llm_module.LLMClient, "is_mock", property(lambda self: False))


class TestGenerationIntegration:
    def test_degraded_gap_lands_in_db(self, client, auth_headers, monkeypatch):
        _fake_openai(
            monkeypatch,
            '{"id":"g-root","type":"frame","style":{"layout":"column"},"children":[{"id":"p1","type":"pagination"}]}',
        )
        resp = client.post("/api/generate", json={"prompt": "设计一个列表页", "session_key": "s-gap-int"}, headers=auth_headers)
        assert resp.status_code == 200
        assert resp.json()["degraded"] == ["pagination@p1"]
        assert resp.json()["gaps_summary"] == {"degraded": 1}  # 摘要只含计数，无 detail 原文
        rows = _rows("s-gap-int")
        assert [r.detail for r in rows if r.gap_type == "degraded"] == ["pagination"]
        assert all(r.node_id == "p1" and r.llm_model == "fake-model" for r in rows if r.gap_type == "degraded")

    def test_ops_rejected_gaps_per_op_rows(self, client, auth_headers, monkeypatch):
        """ops 整批原子拒绝：逐 op 行（insert 记尺寸 node/depth，按首现顺序）+ 人话原因不进 DB。"""
        ops = (
            '{"ops":['
            '{"op":"bogus","target":"root"},'
            '{"op":"insert","parent":"root","index":0,"node":{"id":"x1","type":"text","props":{"text":"t"}}},'
            '{"op":"insert","parent":"root","index":1,"node":{"id":"x2","type":"text","props":{"text":"t"}}},'
            '{"op":"set_style","target":"root","style":{"width":100}}'
            "]}"
        )
        _fake_openai(monkeypatch, ops)
        resp = client.post(
            "/api/generate",
            json={
                "prompt": "把标题改成新文案",
                "session_key": "s-gap-ops",
                "design": {"id": "root", "type": "frame", "style": {"layout": "column"}, "children": []},
            },
            headers=auth_headers,
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["fallback"] is True
        assert "无法落地" in body["error"]  # 人话原因在这里，不在台账
        assert body["gaps_summary"] == {"ops_rejected": 4}  # 摘要计数 = 被拒 op 行数（逐 op，不去重）
        rows = [r for r in _rows("s-gap-ops") if r.gap_type == "ops_rejected"]
        assert [r.detail for r in rows] == [
            "ops:bogus",
            "ops:insert.node1.depth1",
            "ops:insert.node1.depth1",
            "ops:set_style",
        ]  # 逐 op 保序；insert 尺寸为 _subtree_size 实算
        assert all(r.node_id == "" and r.llm_model == "fake-model" for r in rows)
        assert all("未知" not in r.detail and "数组" not in r.detail for r in rows)

    def test_ops_rejected_summary_capped_at_5(self, client, auth_headers, monkeypatch):
        """6 条 op 被拒（逐 op 行、记录上限 5）→ 台账 5 行、摘要 ops_rejected=5。
        语义钉死：N 是"被拒 op 行数（≤5）"，不代表实际被拒 op 数（6 条时 N=5 < 6）。"""
        ops = '{"ops":[{"op":"t1"},{"op":"t2"},{"op":"t3"},{"op":"t4"},{"op":"t5"},{"op":"t6"}]}'
        _fake_openai(monkeypatch, ops)
        resp = client.post(
            "/api/generate",
            json={
                "prompt": "把标题改成新文案",
                "session_key": "s-gap-cap",
                "design": {"id": "root", "type": "frame", "style": {"layout": "column"}, "children": []},
            },
            headers=auth_headers,
        )
        assert resp.status_code == 200
        assert resp.json()["gaps_summary"] == {"ops_rejected": 5}
        assert len([r for r in _rows("s-gap-cap") if r.gap_type == "ops_rejected"]) == 5

    def test_mock_generation_writes_no_gaps(self, client, auth_headers):
        """mock 模式：模板稿即产物，没有模型调用也没有缺口（摘要 null，mock 另有 SourceBadge 提示）。"""
        resp = client.post("/api/generate", json={"prompt": "设计一个登录页", "session_key": "s-gap-mock"}, headers=auth_headers)
        assert resp.status_code == 200
        assert resp.json()["mock"] is True
        assert resp.json()["gaps_summary"] is None
        assert _rows("s-gap-mock") == []


# ---- 原文旁路日志（capability_gap_detail.log，T52 收尾批）----
# 专用 logger propagate=False，caplog 收不到——用自定义 handler 捕获。


class _CaptureHandler(logging.Handler):
    def __init__(self):
        super().__init__()
        self.messages: list[str] = []

    def emit(self, record):
        self.messages.append(record.getMessage())


class TestGapOriginalLog:
    def test_original_in_dedicated_log_and_db_sanitized(self, client, auth_headers, monkeypatch):
        """红线双侧：AI 自创中文键名的**原文**进专用日志（供排查），DB 落的是净化值。"""
        ai_ledger._SEEN_GAP_ORIGINALS.clear()  # 清 LRU：其他用例可能已记录过同 detail 导致去重
        _fake_openai(
            monkeypatch,
            '{"id":"g-root","type":"frame","style":{"layout":"column"},"children":'
            '[{"id":"p1","type":"pagination"},'
            '{"id":"k1","type":"component","componentType":"card","props":{"title":"t","用户备注":"x"}}]}',
        )
        capture = _CaptureHandler()
        gap_logger = logging.getLogger("ai.gap_detail")
        gap_logger.addHandler(capture)
        try:
            resp = client.post(
                "/api/generate", json={"prompt": "设计一个列表页", "session_key": "s-gap-orig"}, headers=auth_headers
            )
            assert resp.status_code == 200
        finally:
            gap_logger.removeHandler(capture)

        joined = "\n".join(capture.messages)
        assert "props.用户备注" in joined, "原文必须进专用日志（排查依据）"
        rows = _rows("s-gap-orig")
        assert any(r.detail == "props.<non-ascii>" for r in rows), "DB 只允许净化值"
        assert all("用户备注" not in (r.detail or "") for r in rows)

    def test_lru_dedup_same_gap_type_detail_logged_once(self, client):
        """同一 (gap_type, detail) 重复落库 → 原文日志只写首见一次；不同 detail 各写一次。"""
        ai_ledger._SEEN_GAP_ORIGINALS.clear()  # 隔离其他测试的 LRU 残留
        capture = _CaptureHandler()
        gap_logger = logging.getLogger("ai.gap_detail")
        gap_logger.addHandler(capture)
        try:
            row = {"gap_type": "degraded", "detail": "pagination"}
            ai_ledger.record_capability_gaps([dict(row, node_id="a")], session_key="s-lru-1")
            ai_ledger.record_capability_gaps([dict(row, node_id="b")], session_key="s-lru-2")  # 同 detail 不同节点 → 仍去重
            ai_ledger.record_capability_gaps([{"gap_type": "degraded", "detail": "dialog"}], session_key="s-lru-3")
        finally:
            gap_logger.removeHandler(capture)

        pagination_lines = [m for m in capture.messages if "pagination" in m]
        assert len(pagination_lines) == 1
        assert "node_id='a'" in pagination_lines[0], "日志行内 node_id 为首见实例（分布看 DB）"
        assert sum(1 for m in capture.messages if "dialog" in m) == 1
