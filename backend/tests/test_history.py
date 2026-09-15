"""T24：会话历史接入生成链路（消息组装 / 归属校验 / 机器摘要 / 编辑不摘要 / 预算）。"""
import json
from types import SimpleNamespace

from app.config import get_settings
from app.db import SessionLocal
from app.services import sessions as sessions_service
from app.services.generate import generate_design
from app.services.history import recent_turns
from app.services.llm import LLMClient, _sanitize_history

CURRENT = {
    "id": "root",
    "type": "frame",
    "style": {"layout": "column", "gap": 16},
    "children": [
        {"id": "title", "type": "text", "props": {"text": "商品标题"}},
        {"id": "buy", "type": "component", "componentType": "button", "props": {"text": "加入购物车"}},
    ],
}


class _FakeCompletions:
    def __init__(self) -> None:
        self.kwargs: dict | None = None

    def create(self, **kwargs):
        self.kwargs = kwargs
        message = SimpleNamespace(content="{}")
        return SimpleNamespace(
            choices=[SimpleNamespace(message=message, finish_reason="stop")],
            usage=None,
            model="fake-model",
        )


def _real_mode(monkeypatch, recorder: list) -> None:
    """零网络模拟真实模型：is_mock=False + _real_chat 记录 (system, user, history) 后返回原树。"""
    monkeypatch.setattr(LLMClient, "is_mock", property(lambda self: False))
    monkeypatch.setattr(
        LLMClient,
        "_real_chat",
        lambda self, system, user, temperature, history=None, deadline=None, **_kwargs: (
            recorder.append({"system": system, "user": user, "history": history}) or json.dumps(CURRENT)
        ),
    )


class TestMessageAssembly:
    """多轮 messages 组装：system → history → user（历史为空时与旧行为逐字相同）。"""

    def test_create_assembles_multi_turn_messages(self):
        completions = _FakeCompletions()
        fake_client = SimpleNamespace(chat=SimpleNamespace(completions=completions))
        LLMClient()._create(
            fake_client,
            "m",
            "SYS",
            "USER",
            0.3,
            [{"role": "user", "content": "上一轮"}, {"role": "assistant", "content": "已生成一版设计稿"}],
        )
        assert completions.kwargs["messages"] == [
            {"role": "system", "content": "SYS"},
            {"role": "user", "content": "上一轮"},
            {"role": "assistant", "content": "已生成一版设计稿"},
            {"role": "user", "content": "USER"},
        ]

    def test_create_without_history_is_single_turn(self):
        completions = _FakeCompletions()
        fake_client = SimpleNamespace(chat=SimpleNamespace(completions=completions))
        LLMClient()._create(fake_client, "m", "SYS", "USER", 0.3)
        assert completions.kwargs["messages"] == [
            {"role": "system", "content": "SYS"},
            {"role": "user", "content": "USER"},
        ]

    def test_history_sanitizer_drops_invalid_whole_block(self):
        """任一轮次非法（role 非 user/assistant、内容空）→ 整段丢弃，不掺半条。"""
        assert _sanitize_history(None) == []
        assert _sanitize_history([{"role": "user", "content": "a"}]) == [{"role": "user", "content": "a"}]
        assert _sanitize_history([{"role": "user", "content": "a"}, {"role": "system", "content": "x"}]) == []
        assert _sanitize_history([{"role": "user", "content": "   "}]) == []

    def test_generate_passes_history_to_model_and_payload(self, monkeypatch):
        """端到端：generate_design 把历史同时交给模型（messages）与 user payload。"""
        recorder: list = []
        _real_mode(monkeypatch, recorder)
        history = [{"role": "user", "content": "把标题改小"}, {"role": "assistant", "content": "已按指令修改画布"}]
        result = generate_design("把按钮改红", LLMClient(), current_design=CURRENT, history=history)
        assert result.fallback is False, result.error
        assert len(recorder) == 1  # 编辑模式：只有填充调用
        assert recorder[0]["history"] == history
        payload = json.loads(recorder[0]["user"])
        assert payload["history"] == history
        assert payload["user_request"] == "把按钮改红"


class TestRecentTurns:
    """recent_turns：只读本人会话；assistant 轮给机器摘要而不是回执原文。"""

    def test_requires_owned_session(self, client, auth_headers):
        db = SessionLocal()
        try:
            owner = sessions_service.owner_id_of(db, "demo")
            assert owner is not None
            session, _ = sessions_service.get_or_create_session(db, owner, "s-hist-own")
            sessions_service.append_messages(db, session, [{"role": "user", "text": "把标题改小"}])

            assert recent_turns(db, None, "demo") == []  # 未传会话
            assert recent_turns(db, "s-not-exist", "demo") == []  # 会话不存在
            assert recent_turns(db, "s-hist-own", "someone-else") == []  # 越权：他人读不到
            assert recent_turns(db, "s-hist-own", "demo")[0]["content"] == "把标题改小"
        finally:
            db.close()

    def test_assistant_turn_is_machine_summary(self, client, auth_headers):
        db = SessionLocal()
        try:
            owner = sessions_service.owner_id_of(db, "demo")
            session, _ = sessions_service.get_or_create_session(db, owner, "s-hist-summary")
            sessions_service.append_messages(db, session, [{"role": "user", "text": "设计一个登录页"}])
            # 前端顺序：先记账（本节机器摘要的来源），后写回执
            sessions_service.record_tool_call(db, session, "generate", True)
            sessions_service.append_messages(
                db,
                session,
                [{"role": "assistant", "text": "已生成设计稿（模板：login）✓ 规范兼容率 100%\n可在右侧属性面板继续编辑"}],
            )

            turns = recent_turns(db, "s-hist-summary", "demo")
            assert [t["role"] for t in turns] == ["user", "assistant"]
            assert turns[0]["content"] == "设计一个登录页"
            assert turns[1]["content"] == "已生成一版设计稿"
            assert "可在右侧属性面板" not in turns[1]["content"]  # 不回喂模板回执原文
        finally:
            db.close()

    def test_budget_drops_oldest_and_truncates(self, client, auth_headers, monkeypatch):
        monkeypatch.setattr(get_settings(), "llm_history_max_chars", 30)
        db = SessionLocal()
        try:
            owner = sessions_service.owner_id_of(db, "demo")
            session, _ = sessions_service.get_or_create_session(db, owner, "s-hist-budget")
            long_user = "把这句话改小一点" * 5  # 40 字符 > 剩余预算，必须触发截断
            sessions_service.append_messages(db, session, [{"role": "user", "text": long_user}])
            sessions_service.record_tool_call(db, session, "incremental-edit", True)
            sessions_service.append_messages(db, session, [{"role": "assistant", "text": "已应用修改（回执原文不应进历史）"}])

            turns = recent_turns(db, "s-hist-budget", "demo")
            total = sum(len(t["content"]) for t in turns)
            assert total <= 31, f"超出字符预算：{total}"  # 预算 30 + 截断省略号
            assert turns[-1]["content"] == "已按指令修改画布"  # 最新一轮（机器摘要）始终保留
            assert turns[0]["content"].endswith("…")  # 超预算的旧轮被截断
        finally:
            db.close()


class TestEditNotSummarized:
    """T24：编辑模式的指令必须原样进模型（首轮生成仍按阈值摘要）。"""

    def test_long_edit_instruction_kept_verbatim(self, monkeypatch):
        long_prompt = "把标题改成更醒目的样子，" * 60  # >400 字符
        assert len(long_prompt) > 400
        recorder: list = []
        _real_mode(monkeypatch, recorder)
        result = generate_design(long_prompt, LLMClient(), current_design=CURRENT)
        assert result.fallback is False, result.error
        assert len(recorder) == 1, "编辑模式不应产生摘要调用"
        assert json.loads(recorder[0]["user"])["user_request"] == long_prompt
