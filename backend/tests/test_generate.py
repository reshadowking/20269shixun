"""生成管线测试：mock 模式走通、模板匹配、合规检查、Schema 回退、接口测试。"""

from app.services.compliance import compliance_rate, enforce_compliance
from app.services.generate import GenerateResult, generate_design
from app.services.llm import LLMClient
from app.services.templates import TEMPLATES, match_template


class MockResponder:
    """可编程 mock LLM：按调用次数返回预设 JSON。"""

    def __init__(self, intent: dict | None = None, fill: dict | None = None):
        self.intent = intent
        self.fill = fill
        self.calls = 0

    def __call__(self, system: str, user: str) -> str:
        import json

        self.calls += 1
        # 第一次调用 = 意图解析；第二次 = 参数填充
        payload = self.intent if self.calls == 1 else self.fill
        return json.dumps(payload, ensure_ascii=False) if payload else ""


def _client(mock: MockResponder) -> LLMClient:
    # mock 模式：绕过 settings，直接注入 responder
    client = LLMClient(mock_responder=mock)
    return client


class TestTemplateMatching:
    def test_llm_template_priority(self):
        assert match_template("随便", "ecommerce") == "ecommerce"
        assert match_template("随便", "not-a-template") != "not-a-template"

    def test_keyword_matching(self):
        assert match_template("帮我设计一个登录页面") == "login"
        assert match_template("电商优惠券活动页") == "ecommerce"
        assert match_template("数据仪表板，深色") == "dashboard"
        assert match_template("随便说说") == "landing"  # 兜底

    def test_all_templates_renderable_schema(self):
        """8 个模板全部可通过 Schema 校验（可渲染）。"""
        from app.design.validator import validate_design

        for name, template in TEMPLATES.items():
            validate_design(template), f"模板 {name} 不合法"


class TestGeneratePipeline:
    def test_mock_fallback_returns_template(self):
        """LLM 无响应（mock 空）→ 返回模板默认稿（断网兜底）。"""
        result = generate_design("设计一个登录页", _client(MockResponder(intent=None, fill=None)))
        assert isinstance(result, GenerateResult)
        assert result.template == "login"
        assert result.fallback is False  # mock 模板稿即输出，不标记降级
        assert result.design["id"]  # 可渲染的树
        assert result.compliance >= 85  # 模板默认稿令牌合规

    def test_mock_with_intent_and_fill(self):
        mock = MockResponder(
            intent={"template": "ecommerce", "theme": "default", "components": ["按钮"], "copy_intent": "促销", "style_intent": "圆角", "tone": "活泼"},
            fill={"id": "gen-root", "type": "frame", "style": {"layout": "column"}, "children": []},
        )
        result = generate_design("电商优惠券页", _client(mock))
        assert result.template == "ecommerce"
        assert result.fallback is False
        assert result.design["id"] == "gen-root"

    def test_fill_invalid_schema_falls_back(self):
        """LLM 产物 Schema 不合法 → 回退模板，不把脏数据上画布。"""
        mock = MockResponder(
            intent={"template": "login", "theme": "default", "components": [], "copy_intent": "x", "style_intent": "y", "tone": "z"},
            fill={"id": "bad", "type": "not-a-type"},  # 非法节点类型
        )
        result = generate_design("登录页", _client(mock))
        assert result.fallback is False
        assert result.design["id"] == "login-root"  # 回退到模板

    def test_fill_non_json_retries(self):
        """非 JSON 输出重试后仍失败 → 兜底模板。"""
        mock = MockResponder()
        mock.__call__ = lambda s, u: "not json at all"  # type: ignore[assignment]
        result = generate_design("首页", LLMClient(mock_responder=mock))
        assert result.fallback is False  # mock 模式不标记降级
        assert result.design["id"]


class TestCompliance:
    def test_non_token_color_pulled_back(self):
        design = {
            "id": "root", "type": "frame", "style": {"layout": "column"},
            "children": [
                {"id": "a", "type": "text", "style": {"color": "#123456", "fontSize": 14}},
                {"id": "b", "type": "text", "style": {"color": "primary"}},
            ],
        }
        fixed, fixes, total = enforce_compliance(design)
        assert len(fixes) == 1
        assert total == 2
        assert fixed["children"][0]["style"]["color"] == "text-primary"  # #123456 拉回最近令牌
        assert fixed["children"][1]["style"]["color"] == "primary"  # 合法值不动
        assert compliance_rate(len(fixes), total) == 50.0
        # B2-2：明细记录 node_id/field/original/corrected（供逐项报告与还原）
        assert fixes[0].node_id == "a" and fixes[0].field == "color"
        assert fixes[0].original == "#123456" and fixes[0].corrected == "text-primary"

    def test_case_insensitive_hex_allowed(self):
        design = {"id": "r", "type": "text", "style": {"color": "#ff6b6b"}}
        _, fixes, total = enforce_compliance(design)
        assert len(fixes) == 0 and total == 1
        assert compliance_rate(0, 1) == 100.0

    def test_user_specified_brand_color_kept(self):
        """问题 8：用户明确指定的品牌色不被合规检查器拉回（v2.2 §4.5）。"""
        design = {"id": "r", "type": "frame", "style": {"layout": "column"},
                  "children": [{"id": "btn", "type": "component", "componentType": "button", "style": {"color": "#FF6B35"}}]}
        fixed, fixes, _ = enforce_compliance(design, allowed_extra=["#FF6B35"])
        assert len(fixes) == 0
        assert fixed["children"][0]["style"]["color"] == "#FF6B35"

    def test_extract_user_colors(self):
        from app.services.generate import extract_user_colors

        assert extract_user_colors("主色 #FF6B35 配白色") == ["#FF6B35"]
        assert extract_user_colors("没有颜色") == []
        assert extract_user_colors("#aaa 和 #FF6B35 和 #aaa") == ["#aaa", "#FF6B35"]  # 去重保序

    def test_brand_family_blue_shades_kept(self):
        """用户品牌色的同色相变体（Tailwind 蓝色系深浅）不拉回。"""
        for shade in ["#3B82F6", "#1D4ED8", "#1E3A8A", "#DBEAFE", "#EFF6FF"]:
            design = {"id": "r", "type": "text", "style": {"color": shade}}
            _, fixes, _ = enforce_compliance(design, allowed_extra=["#2563EB"])
            assert len(fixes) == 0, f"{shade} 应视为品牌色系"

    def test_other_hue_pulled_to_brand(self):
        """红色系（不同色相）拉回用户品牌色而非默认令牌。"""
        design = {"id": "r", "type": "text", "style": {"color": "#FF0000"}}
        fixed, fixes, _ = enforce_compliance(design, allowed_extra=["#2563EB"])
        assert len(fixes) == 1
        assert fixed["style"]["color"] == "#2563EB"

    def test_neutral_gray_not_brand_family(self):
        """纯中性灰（无色相）不算品牌色系；深蓝灰（色相为蓝）算。"""
        design = {"id": "r", "type": "text", "style": {"color": "#808080"}}
        _, fixes, _ = enforce_compliance(design, allowed_extra=["#2563EB"])
        assert len(fixes) == 1
        design2 = {"id": "r2", "type": "text", "style": {"color": "#0F172A"}}
        _, fixes2, _ = enforce_compliance(design2, allowed_extra=["#2563EB"])
        assert len(fixes2) == 0  # slate-900 色相为蓝（222°），蓝色主题下合理

    def test_unsimilar_color_pulled_to_brand(self):
        """差异大的颜色（红）拉回用户品牌色而非默认令牌。"""
        design = {"id": "r", "type": "text", "style": {"color": "#FF0000"}}
        fixed, fixes, _ = enforce_compliance(design, allowed_extra=["#2563EB"])
        assert len(fixes) == 1
        assert fixed["style"]["color"] == "#2563EB"

    def test_no_style_attrs_is_full_compliance(self):
        assert compliance_rate(0, 0) == 100.0


class TestGenerateAPI:
    def test_generate_endpoint_mock(self, client, auth_headers):
        """mock 模式下接口可走通（CI 零网络）。"""
        resp = client.post("/api/generate", json={"prompt": "设计一个登录页"}, headers=auth_headers)
        assert resp.status_code == 200
        body = resp.json()
        assert body["template"] in TEMPLATES
        assert "design" in body
        assert body["compliance"] >= 0

    def test_generate_invalid_prompt(self, client, auth_headers):
        resp = client.post("/api/generate", json={"prompt": ""}, headers=auth_headers)
        assert resp.status_code == 422

    def test_templates_list(self, client, auth_headers):
        resp = client.get("/api/generate/templates", headers=auth_headers)
        assert resp.status_code == 200
        assert len(resp.json()["templates"]) == 8

    def test_check_compliance_endpoint(self, client, auth_headers):
        resp = client.post("/api/check-compliance", json={"design": {"id": "x", "type": "text", "style": {"color": "#123456"}}}, headers=auth_headers)
        assert resp.status_code == 200
        body = resp.json()
        assert body["violations"] == 1
        # B2-2：逐项明细随响应透传（前端逐项报告/还原的数据源）
        assert body["violations_detail"] == [
            {"node_id": "x", "field": "color", "original": "#123456", "corrected": "text-primary"}
        ]
        assert body["compliance"] == 0.0  # 唯一颜色字段被拉回：1/1 违规

    def test_check_compliance_detail_empty_when_clean(self, client, auth_headers):
        resp = client.post(
            "/api/check-compliance",
            json={"design": {"id": "y", "type": "text", "style": {"color": "primary"}}},
            headers=auth_headers,
        )
        assert resp.status_code == 200
        assert resp.json()["violations_detail"] == []

    def test_generate_response_carries_detail_field(self, client, auth_headers):
        """生成响应携带 violations_detail 字段（mock 模板 100% 合规时为空列表）。"""
        resp = client.post("/api/generate", json={"prompt": "设计一个登录页"}, headers=auth_headers)
        assert resp.status_code == 200
        body = resp.json()
        assert "violations_detail" in body
        assert isinstance(body["violations_detail"], list)

    def test_explore_options_returns_two_valid_designs(self, client, auth_headers):
        """D3：/api/generate/explore 返回 2 份合法方案（mock 环境可跑，零网络）。"""
        from app.design.validator import validate_design_safe

        resp = client.post("/api/generate/explore", json={"prompt": "设计一个电商优惠券页"}, headers=auth_headers)
        assert resp.status_code == 200
        body = resp.json()
        assert len(body["options"]) == 2
        assert isinstance(body["degraded"], bool)
        for opt in body["options"]:
            assert opt["label"].startswith("方案")
            for key in ("design", "template", "compliance", "violations"):
                assert key in opt, f"缺字段 {key}"
            ok, errors = validate_design_safe(opt["design"])
            assert ok, f"方案不合法: {errors[:3]}"

    def test_explore_rejects_non_design_prompt(self, client, auth_headers):
        resp = client.post("/api/generate/explore", json={"prompt": "帮我写一首诗"}, headers=auth_headers)
        assert resp.status_code == 422


class TestApiErrorDescription:
    def test_status_error_has_http_code(self):
        import httpx
        from openai import APIStatusError

        from app.services.llm import describe_api_error

        req = httpx.Request("POST", "https://api.deepseek.com/v1/chat/completions")
        resp = httpx.Response(429, request=req)
        exc = APIStatusError("rate limited", response=resp, body=None)
        msg = describe_api_error(exc)
        assert "429" in msg

    def test_timeout_error(self):
        from openai import APITimeoutError

        from app.services.llm import describe_api_error

        assert "超时" in describe_api_error(APITimeoutError("slow"))
