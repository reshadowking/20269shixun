"""追问模式测试（Q1-Q5）：4 档模式、Q4 智能判断五规则、Q5 关闭模式特殊处理、接口契约。"""

from app.services.questions import analyze_questions


def keys_of(prompt: str, mode: str = "smart") -> list[str]:
    return [q.key for q in analyze_questions(prompt, mode).questions]


class TestSmartRules:
    """Q4 智能模式完整度判断规则。"""

    def test_rule1_page_type_missing_asks(self):
        """规则①：页面类型不明确 → 必须追问（问题含"随便选一个"选项）。"""
        a = analyze_questions("做一个页面")
        assert [q.key for q in a.questions] == ["page_type"]
        assert a.page_type is None
        assert "随便选一个" in a.questions[0].options

    def test_rule2_type_clear_style_missing_asks_one(self):
        """规则②：类型明确但风格没说 → 追问 1 个（风格）。"""
        a = analyze_questions("设计一个登录页")
        assert [q.key for q in a.questions] == ["style"]
        assert a.page_type == "login"
        assert a.style_known is False

    def test_rule3_both_clear_no_ask(self):
        """规则③：类型 + 风格都明确 → 不追问。"""
        assert analyze_questions("设计一个简洁的登录页面").questions == []
        assert analyze_questions("设计一个深色科技风的电商优惠券页").questions == []
        assert analyze_questions("做一个红色调的数据仪表板").questions == []

    def test_rule4_casual_words_no_ask(self):
        """规则④：用户说"随便/快速" → 不追问（优先级最高）。"""
        assert analyze_questions("随便设计一个页面").questions == []
        assert analyze_questions("快速生成一个登录页").questions == []
        assert analyze_questions("你定吧，做个落地页").questions == []

    def test_rule5_max_two_questions(self):
        """规则⑤：最多追问 2 个（类型 + 风格），不超出。"""
        a = analyze_questions("帮我做一个页面")
        assert len(a.questions) == 1  # 类型不明只问类型（风格问题留给回答后的第二轮）
        # 极端场景：什么都不说 + detailed → 类型 + 风格 = 2
        d = analyze_questions("帮我做一个页面", mode="detailed")
        assert len(d.questions) == 2
        assert [q.key for q in d.questions] == ["page_type", "style"]


class TestModes:
    def test_smart_default(self):
        assert analyze_questions("设计一个登录页").mode == "smart"
        # 类型明确但风格不明 → 1 个风格问题
        assert keys_of("设计一个登录页") == ["style"]
        # 都明确 → 不问
        assert keys_of("设计一个极简的登录页") == []

    def test_concise_minimal(self):
        """精简：只问必要问题（类型不明问 1 个），类型明确即使风格没说也不问。"""
        assert keys_of("做一个页面", mode="concise") == ["page_type"]
        assert keys_of("设计一个登录页", mode="concise") == []

    def test_detailed_more_questions(self):
        """详细：类型不明问类型；风格未明确问风格；都明确再问内容重点。"""
        assert keys_of("做一个页面", mode="detailed") == ["page_type", "style"]
        assert keys_of("设计一个登录页", mode="detailed") == ["style"]
        assert keys_of("设计一个简洁的登录页", mode="detailed") == ["focus"]

    def test_off_only_q5_case(self):
        """关闭：默认不追问；Q5 例外——类型缺失时仍问 1 次（带随便选按钮）。"""
        assert keys_of("设计一个登录页", mode="off") == []
        a = analyze_questions("做一个页面", mode="off")
        assert [q.key for q in a.questions] == ["page_type"]
        assert "随便选一个" in a.questions[0].options

    def test_invalid_mode_falls_back_to_smart(self):
        assert analyze_questions("设计一个登录页", mode="unknown").mode == "smart"


class TestQuestionContent:
    def test_style_options_have_default_and_random(self):
        a = analyze_questions("设计一个登录页")
        q = a.questions[0]
        assert q.question == "希望是什么风格？"
        assert q.default == "简洁现代"
        assert q.options[-1] == "随便选一个"

    def test_page_type_options_cover_templates(self):
        a = analyze_questions("做一个页面")
        q = a.questions[0]
        assert q.question == "请问是什么类型的页面？"
        assert q.default == "落地页"
        assert "登录页" in q.options and "电商页" in q.options


class TestQuestionsApi:
    def test_api_returns_questions(self, client, auth_headers):
        resp = client.post("/api/generate/questions", json={"prompt": "做一个页面", "mode": "smart"}, headers=auth_headers)
        assert resp.status_code == 200
        body = resp.json()
        assert body["mode"] == "smart"
        assert body["page_type"] is None
        assert len(body["questions"]) == 1
        assert body["questions"][0]["key"] == "page_type"
        assert body["questions"][0]["options"][-1] == "随便选一个"

    def test_api_no_questions_when_clear(self, client, auth_headers):
        resp = client.post("/api/generate/questions", json={"prompt": "设计一个简洁的登录页"}, headers=auth_headers)
        assert resp.status_code == 200
        assert resp.json()["questions"] == []

    def test_api_invalid_mode_rejected(self, client, auth_headers):
        resp = client.post("/api/generate/questions", json={"prompt": "登录页", "mode": "turbo"}, headers=auth_headers)
        assert resp.status_code == 422

    def test_api_off_mode_q5(self, client, auth_headers):
        resp = client.post("/api/generate/questions", json={"prompt": "做一个页面", "mode": "off"}, headers=auth_headers)
        assert resp.status_code == 200
        body = resp.json()
        assert len(body["questions"]) == 1
        assert body["questions"][0]["key"] == "page_type"

    def test_api_empty_prompt_rejected(self, client, auth_headers):
        resp = client.post("/api/generate/questions", json={"prompt": "  "}, headers=auth_headers)
        assert resp.status_code == 422
