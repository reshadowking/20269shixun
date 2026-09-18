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
        """LLM 产物修复后仍不合法 → 回退模板，不把脏数据上画布。
        （T8 后 type:"not-a-type" 可降级为 frame；T17 后"根节点缺 id"也已被抢救——
        见 test_unwrap.py::TestUnwrapDesign::test_missing_root_id_rescued 与
        TestUnwrapDesignPipeline::test_missing_root_id_adopted_end_to_end。
        本用例改用仍然不可抢救的形态：整个对象不是设计节点。"""
        mock = MockResponder(
            intent={"template": "login", "theme": "default", "components": [], "copy_intent": "x", "style_intent": "y", "tone": "z"},
            fill={"explanation": "x", "steps": []},  # 非设计节点：解包/修复后仍缺 id
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

    def test_color_words_become_user_colors(self):
        """2026-09-18：只给"色系词"也要能被识别为用户指定色。

        此前只提取 hex，于是"做一个橙色调的电商页"返回空列表 → 模型正常产出的橙色
        `#FF7A00` 被合规检查"拉回最近令牌"→ danger（红）：**用户要橙，出稿是红**。
        """
        from app.services.generate import extract_user_colors

        assert extract_user_colors("做一个橙色调的电商页") == ["#FF7A00"]
        assert extract_user_colors("紫色科技风") == ["#7C4DFF"]
        assert extract_user_colors("blue dashboard") == ["#0052D9"]
        # hex 优先且保序（第一个元素是"越界色拉回的目标"）
        assert extract_user_colors("用 #FF6B35 做主色，橙色点缀") == ["#FF6B35", "#FF7A00"]
        # 黑白灰不进列表：白/黑本就在允许 hex 里、灰走中性通道，
        # 塞进去会让 extra[0] 变成黑白，越界色就会被拉成黑白
        assert extract_user_colors("黑白极简风") == []
        assert extract_user_colors("灰色背景") == []

    def test_color_word_request_survives_compliance(self):
        """端到端：用户说"橙色调"，模型给的橙色必须原样保留（改前会被拉成 danger 红）。"""
        from app.services.generate import extract_user_colors

        allowed = extract_user_colors("做一个橙色调的电商页，圆角风格")
        design = {
            "id": "root",
            "type": "frame",
            "style": {"layout": "column"},
            "children": [
                {"id": "btn", "type": "component", "componentType": "button", "style": {"background": "#FF7A00"}}
            ],
        }
        fixed, fixes, _ = enforce_compliance(design, allowed_extra=allowed)
        assert fixes == []
        assert fixed["children"][0]["style"]["background"] == "#FF7A00"

    def test_color_word_section_injected_in_prompts(self):
        """色系对照表要在生成/自由/修改三条提示词里都有（内容由单一来源现算）。"""
        from app.services.generate import (
            color_word_section,
            fill_system_text,
            free_system_text,
            incremental_system,
        )

        section = color_word_section()
        for name, text in (
            ("fill", fill_system_text()),
            ("free", free_system_text()),
            ("incremental", incremental_system(False)),
        ):
            assert section in text, name
        assert "橙 #FF7A00" in section  # 表内容来自 COLOR_WORD_HINTS，不手抄

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

    def test_explore_options_carry_degraded_kinds(self, client, auth_headers):
        """T10 批2（缺口清单 §4.8 #16）：每个方案带 degraded_kinds（组件能力降级明细），
        命名刻意区别于响应顶层的 degraded: bool（#17 同名不同义，不得加剧）。"""
        resp = client.post("/api/generate/explore", json={"prompt": "设计一个电商优惠券页"}, headers=auth_headers)
        assert resp.status_code == 200
        body = resp.json()
        for opt in body["options"]:
            assert "degraded_kinds" in opt, "方案缺 degraded_kinds 字段"
            assert isinstance(opt["degraded_kinds"], list)

    def test_explore_rejects_non_design_prompt(self, client, auth_headers):
        resp = client.post("/api/generate/explore", json={"prompt": "帮我写一首诗"}, headers=auth_headers)
        assert resp.status_code == 422

    def test_explore_exposes_per_option_fallback(self, client, auth_headers):
        """缺陷 1：每个方案带 fallback 标记——降级方案必须能与真实生成结果区分，不得混同。

        mock 模式（未配 Key 的演示路径）按产品既有约定不标记降级，故此处全为 False。
        """
        resp = client.post("/api/generate/explore", json={"prompt": "设计一个电商优惠券页"}, headers=auth_headers)
        assert resp.status_code == 200
        body = resp.json()
        assert all(isinstance(o["fallback"], bool) for o in body["options"])
        assert [o["fallback"] for o in body["options"]] == [False, False]
        assert body["degraded"] is False

    def test_explore_marks_degraded_option_when_model_fails(self, client, auth_headers, monkeypatch):
        """模型不可用回退预置模板：该方案 fallback=True、整体 degraded=True（前端据此区分展示）。"""
        from dataclasses import replace

        from app.routers import generate as generate_router

        real = generate_router.generate_design

        def flaky(prompt, *args, **kwargs):
            result = real(prompt, *args, **kwargs)
            # 两个方案在线程池并发执行：按提示词特征定位"方案二"（差异化风格附加约束）而非计数器，避免竞态
            if "明显不同" in prompt:
                return replace(result, fallback=True, error="模拟模型不可用")
            return result

        monkeypatch.setattr(generate_router, "generate_design", flaky)
        resp = client.post("/api/generate/explore", json={"prompt": "设计一个电商优惠券页"}, headers=auth_headers)
        assert resp.status_code == 200
        body = resp.json()
        assert body["degraded"] is True
        assert [o["fallback"] for o in body["options"]] == [False, True]

    def test_explore_exposes_demo_source(self, client, auth_headers):
        """演示模式（未配置模型 Key）显式标注：方案带 mock=True，前端据此显示"演示模板稿"。"""
        resp = client.post("/api/generate/explore", json={"prompt": "设计一个电商优惠券页"}, headers=auth_headers)
        assert resp.status_code == 200
        body = resp.json()
        assert all(isinstance(o["mock"], bool) for o in body["options"])
        assert [o["mock"] for o in body["options"]] == [True, True]

    def test_generate_response_carries_source_flags(self, client, auth_headers):
        """/api/generate 同样区分演示模板稿与模型产物（fallback 与 mock 语义互斥且都向后兼容）。"""
        body = client.post("/api/generate", json={"prompt": "设计一个登录页"}, headers=auth_headers).json()
        assert body["mock"] is True  # 测试环境未配 Key = 演示模式
        assert body["fallback"] is False

    def test_generate_not_mock_when_model_configured_but_fails(self, client, auth_headers, monkeypatch):
        """配了真实模型但调用失败：mock=False + fallback=True（与"演示模板稿"区分开）。

        注意：本用例必须零网络——同时把 is_mock 置 False 并让真实调用立即抛错，
        否则会真的打出去（本地若配了 Key 会消耗额度）。
        """
        from app.services import llm as llm_module

        monkeypatch.setattr(llm_module.LLMClient, "is_mock", property(lambda self: False))

        def boom(self, system, user, temperature, history=None, deadline=None, **_kwargs):
            raise RuntimeError("模拟模型不可用")

        monkeypatch.setattr(llm_module.LLMClient, "_real_chat", boom)
        body = client.post("/api/generate", json={"prompt": "设计一个登录页"}, headers=auth_headers).json()
        assert body["mock"] is False
        assert body["fallback"] is True


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



class TestIconPromptInjection:
    """T9 触点 16：三段 system 确实含图标清单，且清单来自 shared/icon-library.json——
    用"追加假图标 → 提示词同步变化"证明是运行期注入而非手抄（照 beautify 词典测试口径）。"""

    @staticmethod
    def _three_prompts() -> list[tuple[str, str]]:
        from app.services.generate import fill_system_text, free_system_text, incremental_system

        return [
            ("FILL", fill_system_text()),
            ("FREE", free_system_text()),
            ("INCREMENTAL", incremental_system(False)),
        ]

    def test_three_systems_contain_icon_list(self):
        from app.services.generate import icon_names_text

        prompts = self._three_prompts()
        for name, text in prompts:
            assert "可用图标" in text, f"{name} 缺图标清单段"
            for icon_name in icon_names_text().split("、"):
                assert icon_name in text, f"{name} 缺图标名 {icon_name}"

    def test_fake_icon_reaches_all_three_prompts(self):
        """追加假图标 → 三段提示词同步出现；移除后同步消失（读取非抄写）。"""
        from app.services import generate

        generate.ICON_LIBRARY["icons"].append({"name": "测试假图标", "label": "假", "path": "M0 0"})
        try:
            for name, text in self._three_prompts():
                assert "测试假图标" in text, f"{name} 未随 JSON 同步"
        finally:
            generate.ICON_LIBRARY["icons"].pop()
        for name, text in self._three_prompts():
            assert "测试假图标" not in text, f"{name} 移除假图标后仍残留"

    def test_generate_design_actually_sends_icon_section(self):
        """端到端：generate_design 发给模型的 system 含图标段（FILL 路径，SpyResponder 捕获）。"""
        import json as _json

        from app.services.generate import generate_design
        from app.services.llm import LLMClient

        fill = {"id": "root", "type": "frame", "style": {"layout": "column"}, "children": []}

        class SpyResponder:
            def __init__(self):
                self.system_text = ""

            def __call__(self, system: str, user: str) -> str:
                if "设计生成器" in system:
                    self.system_text = system
                    return _json.dumps(fill, ensure_ascii=False)
                return ""

        spy = SpyResponder()
        generate_design("设计一个登录页", LLMClient(mock_responder=spy))
        assert "可用图标" in spy.system_text
        assert "star" in spy.system_text


class TestT9ComponentsNotDegraded:
    """T9 验收：icon/switch/tabs 进白名单后不再被 T8 降级——degraded 为空、节点保持 component。"""

    def test_three_new_components_not_degraded(self):
        from app.services.generate import repair_design

        cases = [
            ("icon", {"name": "star"}),
            ("switch", {"checked": True}),
            ("tabs", {"items": [{"label": "标签一"}], "active": 0}),
        ]
        for ctype, props in cases:
            degraded: list[str] = []
            fixed = repair_design({"id": "n1", "type": "component", "componentType": ctype, "props": props}, degraded)
            assert fixed["type"] == "component", f"{ctype} 被降级"
            assert fixed["componentType"] == ctype
            assert fixed["props"] == props, f"{ctype} props 被改动"
            assert degraded == [], f"{ctype} 产生降级明细"

    def test_generate_tabs_tree_end_to_end(self):
        """端到端：模型返回含 tabs 的树 → 不整树回退、节点保持 component、degraded 为空。"""
        import json as _json

        from app.services.generate import generate_design
        from app.services.llm import LLMClient

        fill = {
            "id": "gen-root", "type": "frame", "style": {"layout": "column"},
            "children": [
                {"id": "t", "type": "text", "props": {"text": "标题"}},
                {"id": "tb", "type": "component", "componentType": "tabs",
                 "props": {"items": [{"label": "详情"}, {"label": "评价"}], "active": 1}},
            ],
        }

        class Responder:
            def __call__(self, system: str, user: str) -> str:
                return _json.dumps(fill, ensure_ascii=False) if "设计生成器" in system else ""

        result = generate_design("登录页", LLMClient(mock_responder=Responder()))
        assert result.fallback is False, result.error
        assert result.design["children"][1]["componentType"] == "tabs"
        assert result.design["children"][1]["props"]["active"] == 1
        assert result.degraded == []


class TestUnwrapDesignPipeline:
    """T17 端到端：包裹形态不再整稿回退。

    必须置为真实模式才能观察到 fallback/error——mock 模式会把非编辑路径的 fallback 复位为 False
    （见 generate.py 的 mock 收尾），这也是"演示模式掩盖真实失败"的已知特性。
    """

    @staticmethod
    def _force_real(monkeypatch, payload: dict) -> None:
        """零网络模拟真实模型：is_mock=False + _real_chat 直接返回预设 payload。"""
        import json

        from app.services import llm as llm_module

        monkeypatch.setattr(llm_module.LLMClient, "is_mock", property(lambda self: False))
        monkeypatch.setattr(
            llm_module.LLMClient,
            "_real_chat",
            lambda self, system, user, temperature, history=None, deadline=None, **_kw: json.dumps(payload, ensure_ascii=False),
        )

    def test_wrapped_tree_adopted_end_to_end(self, monkeypatch):
        tree = {
            "id": "wrapped-root", "type": "frame", "style": {"layout": "column"},
            "children": [{"id": "t", "type": "text", "props": {"text": "标题"}}],
        }
        self._force_real(monkeypatch, {"design": tree, "explanation": "here you go"})
        result = generate_design("设计一个登录页", LLMClient())
        assert result.fallback is False, result.error
        assert result.design == tree

    def test_non_design_payload_still_falls_back(self, monkeypatch):
        """完全非设计形态仍回退（解包不得变成"乱造设计稿"）。"""
        self._force_real(monkeypatch, {"explanation": "no", "steps": [{"id": "1", "type": "button"}]})
        result = generate_design("设计一个登录页", LLMClient())
        assert result.fallback is True
        assert "Schema 校验" in result.error

    def test_missing_root_id_adopted_end_to_end(self, monkeypatch):
        """T17 行为变化：顶层是设计节点形状但缺 id → 补 id="root" 采用（此前会整稿回退模板）。"""
        tree = {"type": "frame", "style": {"layout": "column"}, "children": []}
        self._force_real(monkeypatch, tree)
        result = generate_design("设计一个登录页", LLMClient())
        assert result.fallback is False, result.error
        assert result.design["id"] == "root"
        assert result.design["type"] == "frame"
