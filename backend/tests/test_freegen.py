"""自由生成模式测试（E3-1）：显式指令 / 置信度不足触发 free，不经模板，产物过 Schema 与合规。"""

from app.design.validator import validate_design
from app.services.generate import generate_design, match_template_scores
from app.services.llm import LLMClient
from app.services.templates import free_default_design


def _mock_client(fill: dict | None = None) -> LLMClient:
    import json

    class Responder:
        def __init__(self):
            self.calls = 0

        def __call__(self, system: str, user: str) -> str:
            self.calls += 1
            if self.calls == 1:
                return ""  # 意图解析失败（模拟无 LLM）
            return json.dumps(fill, ensure_ascii=False) if fill else ""

    return LLMClient(mock_responder=Responder())


class TestTemplateScores:
    def test_single_keyword_hits_06(self):
        scores = match_template_scores("设计一个登录页")
        assert scores["login"] >= 0.5

    def test_two_keywords_hit_10(self):
        scores = match_template_scores("电商优惠券活动页")
        assert scores["ecommerce"] == 1.0

    def test_no_keyword_zero(self):
        scores = match_template_scores("做一个页面")
        assert max(scores.values()) == 0.0

    def test_all_under_threshold_for_vague(self):
        scores = match_template_scores("自由生成一个设置页")
        assert max(scores.values()) < 0.5


class TestFreeGeneration:
    def test_explicit_free_keyword(self):
        result = generate_design("自由生成一个设置页", _mock_client())
        assert result.template == "free"
        assert result.fallback is False  # mock 模板稿即输出
        validate_design(result.design)

    def test_vague_prompt_goes_free(self):
        """置信度 <0.5 的模糊需求走自由生成，不再兜底 landing。"""
        result = generate_design("做一个页面", _mock_client())
        assert result.template == "free"
        assert result.design["id"] == "free-root"

    def test_casual_prompt_goes_free(self):
        result = generate_design("随便说说", _mock_client())
        assert result.template == "free"

    def test_clear_template_not_free(self):
        result = generate_design("设计一个登录页", _mock_client())
        assert result.template == "login"
        assert result.design["id"] == "login-root"

    def test_settings_default_contains_expected_components(self):
        design = free_default_design("自由生成一个设置页")
        types = [c.get("componentType") for c in design["children"][1]["children"]]
        assert types == ["input", "select", "button"]

    def test_generic_default_schema_valid_and_compliant(self):
        for prompt in ["自由生成一个页面", "随便设计一个界面"]:
            design = free_default_design(prompt)
            validate_design(design)
            from app.services.compliance import compliance_rate, enforce_compliance

            _, fixes, total = enforce_compliance(design)
            assert compliance_rate(len(fixes), total) >= 85

    def test_free_default_all_components_in_whitelist(self):
        def walk(node):
            if node.get("type") == "component":
                assert node.get("componentType") in {
                    "button", "card", "input", "select", "table", "chart", "stat-block",
                    "navbar", "sidebar", "avatar", "tag", "divider", "title-text", "hero", "image",
                }
            for child in node.get("children") or []:
                walk(child)

        walk(free_default_design("自由生成一个页面"))

    def test_llm_fill_used_when_available(self):
        """自由生成时 LLM 返回完整树 → 直接采用（不经过模板）。"""
        import json

        fill = {
            "id": "free-llm-root", "type": "frame", "style": {"layout": "column"},
            "children": [
                {"id": "n1", "type": "component", "componentType": "navbar", "props": {"title": "设置中心"}},
                {"id": "n2", "type": "component", "componentType": "input", "props": {"label": "昵称"}},
                {"id": "n3", "type": "component", "componentType": "button", "props": {"text": "保存"}},
            ],
        }

        class Responder:
            def __call__(self, system: str, user: str) -> str:
                # 意图解析 system 含"意图解析器"，参数填充 system 含"设计生成器"
                return json.dumps(fill, ensure_ascii=False) if "设计生成器" in system else ""

        result = generate_design("自由生成一个设置页", LLMClient(mock_responder=Responder()))
        assert result.template == "free"
        assert result.fallback is False
        assert result.design["id"] == "free-llm-root"

    def test_llm_free_output_schema_invalid_falls_back(self):
        """自由生成产物 Schema 不合法 → 回退自由兜底稿。"""
        import json

        class Responder:
            def __call__(self, system: str, user: str) -> str:
                return json.dumps({"id": "bad", "type": "not-a-type"}, ensure_ascii=False) if "设计生成器" in system else ""

        result = generate_design("自由生成一个页面", LLMClient(mock_responder=Responder()))
        assert result.fallback is False
        assert result.design["id"] == "free-root"


class TestFreeApi:
    def test_generate_endpoint_free(self, client, auth_headers):
        resp = client.post("/api/generate", json={"prompt": "自由生成一个设置页"}, headers=auth_headers)
        assert resp.status_code == 200
        body = resp.json()
        assert body["template"] == "free"
        assert body["design"]["id"]
        assert body["compliance"] >= 0

    def test_generate_endpoint_clear_template_still_template(self, client, auth_headers):
        resp = client.post("/api/generate", json={"prompt": "设计一个登录页"}, headers=auth_headers)
        assert resp.status_code == 200
        assert resp.json()["template"] == "login"
