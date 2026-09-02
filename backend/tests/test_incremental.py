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
        class BadResponder:
            def __call__(self, system: str, user: str) -> str:
                return json.dumps({"id": "bad", "type": "whatever"}, ensure_ascii=False) if "设计修改器" in system else ""

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
