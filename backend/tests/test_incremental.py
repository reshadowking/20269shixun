"""增量编辑测试（P0-1）：基于当前树只改指定部分，其他节点保持不变；失败兜底原树。"""

import json

from app.services.generate import generate_design
from app.services.llm import LLMClient

CURRENT = {
    "id": "root",
    "type": "frame",
    "style": {"layout": "column", "gap": 16, "background": "background"},
    "children": [
        {"id": "title", "type": "text", "props": {"text": "商品标题"}, "style": {"fontSize": 20, "fontWeight": 600, "color": "text-primary"}},
        {"id": "buy", "type": "component", "componentType": "button", "props": {"text": "加入购物车", "variant": "primary"}, "style": {"width": 160, "height": 40, "radius": 8}},
        {"id": "note", "type": "text", "props": {"text": "包邮说明"}, "style": {"color": "text-light", "fontSize": 12}},
    ],
}


class _EditResponder:
    """模拟 LLM：只改 buy 按钮的颜色与尺寸，其余原样返回。"""

    def __init__(self, fail: bool = False):
        self.fail = fail
        self.calls = 0
        self.received_design = None

    def __call__(self, system: str, user: str) -> str:
        self.calls += 1
        if self.fail:
            return ""
        payload = json.loads(user)
        self.received_design = payload.get("current_design")
        if "设计修改器" not in system:
            return ""
        edited = json.loads(json.dumps(payload["current_design"]))  # 深拷贝
        for child in edited["children"]:
            if child["id"] == "buy":
                child["style"]["color"] = "danger"
                child["style"]["width"] = 200
        return json.dumps(edited, ensure_ascii=False)


class TestIncrementalEdit:
    def test_edit_only_changes_target(self):
        """增量：只改按钮，其他节点逐字段不变。"""
        responder = _EditResponder()
        result = generate_design("把购买按钮改成红色，再大一点", LLMClient(mock_responder=responder), current_design=CURRENT)
        assert result.template == "edit"
        assert result.fallback is False
        assert responder.received_design == CURRENT  # 当前树确实传给了模型
        new = result.design
        # 标题与说明逐字段不变
        assert new["children"][0] == CURRENT["children"][0]
        assert new["children"][2] == CURRENT["children"][2]
        # 根容器不变
        assert new["style"] == CURRENT["style"]
        # 按钮被修改
        assert new["children"][1]["style"]["color"] == "danger"
        assert new["children"][1]["style"]["width"] == 200
        assert new["children"][1]["props"]["text"] == "加入购物车"  # 文本没被误改

    def test_edit_uses_incremental_prompt(self):
        responder = _EditResponder()
        generate_design("改颜色", LLMClient(mock_responder=responder), current_design=CURRENT)
        # 意图解析被跳过：只应有 1 次调用（填充）
        assert responder.calls == 1

    def test_edit_failure_returns_original(self):
        """增量失败：返回原树（画布不变，不丢用户调整）。"""
        responder = _EditResponder(fail=True)
        result = generate_design("把按钮改红", LLMClient(mock_responder=responder), current_design=CURRENT)
        assert result.fallback is True
        assert result.design == CURRENT
        assert result.template == "edit"

    def test_edit_schema_invalid_returns_original(self):
        """T8 后 type:"whatever" 可降级、不再属于坏输入；改用仍不可修复的形态
        （根节点缺 id——repair 不派生根 id），深层意图「不可修复才回退」不变。"""

        class BadResponder:
            def __call__(self, system: str, user: str) -> str:
                return json.dumps({"type": "frame", "content": "x"}, ensure_ascii=False) if "设计修改器" in system else ""

        result = generate_design("改按钮", LLMClient(mock_responder=BadResponder()), current_design=CURRENT)
        assert result.fallback is True
        assert result.design == CURRENT


class TestIncrementalApi:
    def test_generate_with_design_returns_edit(self, client, auth_headers):
        resp = client.post(
            "/api/generate",
            json={"prompt": "把按钮改红", "design": CURRENT},
            headers=auth_headers,
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["template"] == "edit"
        assert body["design"]["id"] == "root"

    def test_questions_with_has_design_not_ask(self, client, auth_headers):
        resp = client.post(
            "/api/generate/questions",
            json={"prompt": "把按钮改红", "mode": "smart", "has_design": True},
            headers=auth_headers,
        )
        assert resp.status_code == 200
        assert resp.json()["questions"] == []

    def test_questions_without_has_design_still_ask(self, client, auth_headers):
        resp = client.post(
            "/api/generate/questions",
            json={"prompt": "做一个页面", "mode": "smart", "has_design": False},
            headers=auth_headers,
        )
        assert resp.status_code == 200
        assert len(resp.json()["questions"]) == 1


class TestIncrementalColorSemantics:
    """缺陷 12：增量 prompt 的改色语义约束（背景 vs 组件）。"""

    def test_prompt_contains_color_semantics(self):
        from app.services.generate import INCREMENTAL_SYSTEM

        assert "背景不变" in INCREMENTAL_SYSTEM
        assert "最外层容器" in INCREMENTAL_SYSTEM
        assert "只改该组件" in INCREMENTAL_SYSTEM

    def test_edit_prompt_passes_semantics_hint(self):
        """发给模型的增量请求应包含语义约束的 system（由 INCREMENTAL_SYSTEM 承载）。"""
        class SpyResponder:
            def __init__(self):
                self.system_text = ""

            def __call__(self, system: str, user: str) -> str:
                if "设计修改器" in system:
                    self.system_text = system
                    return json.dumps(CURRENT, ensure_ascii=False)
                return ""

        spy = SpyResponder()
        generate_design("背景不变，把按钮改成红色", LLMClient(mock_responder=spy), current_design=CURRENT)
        assert "背景不变" in spy.system_text
        assert "只改该组件" in spy.system_text


class TestIncrementalVocabularyInjection:
    """T4 批2：增量提示词注入效果词典（由 shared/beautify-effects.json 生成），locked 只影响措辞。"""

    def test_vocabulary_always_injected(self):
        """locked=False 也含词典（降低自由 CSS 进树概率），但不含锁定约束段。"""
        from app.services.beautify import EFFECT_VALUES
        from app.services.generate import incremental_system

        text = incremental_system(False)
        assert "## 可用美化效果" in text
        # 词典内容与 JSON 同源：每组至少一个预置值逐字出现
        for key, values in EFFECT_VALUES.items():
            assert any(str(v) in text for v in values), f"词典缺组 {key} 的预置值"
        assert "版面锁定阶段" not in text

    def test_locked_section_only_when_locked(self):
        """locked=True 额外含锁定约束段；locked=False 不含。"""
        from app.services.generate import incremental_system

        locked_text = incremental_system(True)
        assert "## 可用美化效果" in locked_text
        assert "版面锁定阶段" in locked_text
        assert "禁止改动布局" in locked_text
        assert "逐字一致" in locked_text

    def test_base_constraints_untouched(self):
        """回归：既有约束文本逐字保留（3 处断言依赖），且词典是追加而非改写。"""
        from app.services.generate import INCREMENTAL_SYSTEM, incremental_system

        for text in (INCREMENTAL_SYSTEM, incremental_system(False), incremental_system(True)):
            assert "背景不变" in text
            assert "最外层容器" in text
            assert "只改该组件" in text
        # 追加式拼装：既有常量原文仍是组合文本的前缀
        assert incremental_system(False).startswith(INCREMENTAL_SYSTEM)

    def test_generate_design_sends_vocabulary_and_locked_section(self):
        """generate_design 按 locked 组装 system：模型实际收到的提示词含词典；locked 时含锁定段。"""
        from app.services.generate import generate_design

        class SpyResponder:
            def __init__(self):
                self.system_text = None

            def __call__(self, system: str, user: str) -> str:
                if "设计修改器" in system:
                    self.system_text = system
                    return json.dumps(CURRENT, ensure_ascii=False)
                return ""

        spy = SpyResponder()
        generate_design("加个阴影", LLMClient(mock_responder=spy), current_design=CURRENT, locked=True)
        assert "## 可用美化效果" in spy.system_text
        assert "版面锁定阶段" in spy.system_text

        spy2 = SpyResponder()
        generate_design("加个阴影", LLMClient(mock_responder=spy2), current_design=CURRENT, locked=False)
        assert "## 可用美化效果" in spy2.system_text
        assert "版面锁定阶段" not in spy2.system_text

    def test_incremental_prompt_off_topic_fallback(self):
        """T10 §2.2：增量路径放行后的提示词兜底——与界面设计无关的要求保持 current_design 原样。"""
        from app.services.generate import incremental_system

        for locked in (False, True):
            text = incremental_system(locked)
            assert "保持 current_design 原样不变" in text, f"locked={locked} 缺兜底"

    def test_prompts_carry_degradation_guidance(self):
        """T8 §4.3：三段 system 末尾各含降级指引（禁止自创 componentType + 最接近合法组件表达）。"""
        from app.services.generate import FILL_SYSTEM, FREE_SYSTEM, incremental_system

        for name, text in (("FILL", FILL_SYSTEM), ("FREE", FREE_SYSTEM), ("INCREMENTAL", incremental_system(False))):
            assert "禁止自创 componentType" in text, f"{name} 缺降级指引"
            assert "最接近的合法组件" in text, f"{name} 缺替代表达指引"

    def test_api_accepts_locked_field(self, client, auth_headers):
        """/api/generate 新增可选 locked：显式传 true 也向后兼容（旧调用方不传仍 200）。"""
        resp_locked = client.post(
            "/api/generate",
            json={"prompt": "把按钮改红", "design": CURRENT, "locked": True},
            headers=auth_headers,
        )
        assert resp_locked.status_code == 200
        assert resp_locked.json()["template"] == "edit"

        resp_legacy = client.post(
            "/api/generate",
            json={"prompt": "把按钮改红", "design": CURRENT},
            headers=auth_headers,
        )
        assert resp_legacy.status_code == 200
        assert resp_legacy.json()["template"] == "edit"
