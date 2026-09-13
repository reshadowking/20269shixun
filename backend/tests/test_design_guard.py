"""AI 角色边界守卫测试（缺陷 9）：无关请求拦截，设计请求放行。"""

import json
from pathlib import Path

from app.services.design_guard import GUARD_REPLY, is_design_request

ROOT = Path(__file__).resolve().parent.parent.parent
SHARED_WORDS = json.loads((ROOT / "shared" / "design-guard-words.json").read_text(encoding="utf-8"))


class TestGuardRules:
    def test_design_requests_allowed(self):
        allowed = [
            "设计一个登录页",
            "做一个电商优惠券领取页，红色调",
            "自由生成一个设置页",
            "把按钮改成红色",
            "把当前界面改为红色",  # 页面词"界面"（UI 词）+ 改成
            "将标题居中，圆角再大一点",
            "帮我做个金融数据仪表板",
            "生成一个个人主页",
            # 缺口清单 §4.6：「组件词+效果词」定向识别（裸"加"不入动词表，防"增加/加载"放行）
            "给所有卡片加阴影",  # 批 2 提示词明确支持的批量表述，曾被动词表误拦
            "卡片加个渐变",
            "给标题加描边",
        ]
        for prompt in allowed:
            assert is_design_request(prompt), f"应放行: {prompt}"

    def test_non_design_requests_blocked(self):
        blocked = [
            "帮我写首诗",
            "1+1 等于几",
            "什么是人工智能",
            "今天天气怎么样",
            "帮我写一段 Python 代码",  # 无页面词 + 无 UI 词（"代码"不在 UI 词表）
            "帮我加载更多按钮",  # §4.6 近似反例：裸"加"未入动词表，且按钮(组件词)无效果词搭配
        ]
        for prompt in blocked:
            assert not is_design_request(prompt), f"应拦截: {prompt}"


class TestGuardWordsTablesSharedSource:
    """T10 §2.3：三张表（pageKeywords/designVerbs/uiKeywords）搬进 shared JSON，两端共读。
    取前后端并集（后端独有的 10 个词是真实缺失，不是脏数据）。"""

    def test_loaded_word_tables_match_shared_file(self):
        from app.services.design_guard import DESIGN_VERBS, PAGE_KEYWORDS, UI_KEYWORDS

        assert list(PAGE_KEYWORDS) == SHARED_WORDS["pageKeywords"]
        assert list(DESIGN_VERBS) == SHARED_WORDS["designVerbs"]
        assert list(UI_KEYWORDS) == SHARED_WORDS["uiKeywords"]

    def test_fake_page_word_takes_effect(self):
        """证明是"读取"而非"抄写"：给加载结果追加假页面词 → 判定即时变化。"""
        from app.services import design_guard

        design_guard.PAGE_KEYWORDS.append("布拉格")
        try:
            assert design_guard.is_design_request("布拉格测试词你好") is True
        finally:
            design_guard.PAGE_KEYWORDS.remove("布拉格")
        assert design_guard.is_design_request("布拉格测试词你好") is False

    def test_union_vectors_previously_divergent(self):
        """§4.9 两端分叉的说法（仅后端有的词）取并集后放行——前端曾拦、后端曾放，现在一致。"""
        from app.services.design_guard import is_design_request

        for prompt in ("把页脚改成深色", "加个轮播图", "做一个数据大屏", "加个推广模块", "开个论坛页面"):
            assert is_design_request(prompt) is True, prompt


class TestGuardApi:
    def test_generate_blocked_with_guard_reply(self, client, auth_headers):
        resp = client.post("/api/generate", json={"prompt": "帮我写首诗"}, headers=auth_headers)
        assert resp.status_code == 422
        assert "AI 设计助手" in resp.json()["detail"]

    def test_generate_questions_blocked(self, client, auth_headers):
        resp = client.post("/api/generate/questions", json={"prompt": "今天天气怎么样"}, headers=auth_headers)
        assert resp.status_code == 422
        assert GUARD_REPLY in resp.json()["detail"]

    def test_generate_with_design_skips_guard(self, client, auth_headers):
        """T10 批1：增量路径（带 design）不再调角色守卫——「加高级功能」这类说法直达模型。"""
        resp = client.post(
            "/api/generate",
            json={"prompt": "加高级功能", "design": {"id": "d1", "type": "frame", "style": {"layout": "column"}, "children": []}},
            headers=auth_headers,
        )
        assert resp.status_code == 200, resp.text[:200]
        assert resp.json()["template"] == "edit"

    def test_generate_without_design_still_guarded_for_same_prompt(self, client, auth_headers):
        """T10 批1：无设计稿时强度保持——同句仍被守卫拦下。"""
        resp = client.post("/api/generate", json={"prompt": "加高级功能"}, headers=auth_headers)
        assert resp.status_code == 422
        assert "AI 设计助手" in resp.json()["detail"]

    def test_generate_questions_has_design_bypass(self, client, auth_headers):
        """增量修改（has_design）放行——改现有设计必是设计请求。"""
        resp = client.post(
            "/api/generate/questions",
            json={"prompt": "改一下", "mode": "smart", "has_design": True},
            headers=auth_headers,
        )
        assert resp.status_code == 200

    def test_generate_design_prompt_still_works(self, client, auth_headers):
        resp = client.post("/api/generate", json={"prompt": "设计一个登录页"}, headers=auth_headers)
        assert resp.status_code == 200


class TestGuardWordsSharedSource:
    """缺口清单 §4.6 方案 A：词表单一来源 shared/design-guard-words.json。

    前后端共用同一文件（照抄 beautify-effects.json 模式）——扩充效果库时只改
    JSON 一处，两端判定自动同步，杜绝"前端放行、后端 422"的人工同步漂移。
    """

    def test_loaded_words_match_shared_file(self):
        from app.services.design_guard import COMPONENT_WORDS, EFFECT_WORDS

        assert list(COMPONENT_WORDS) == SHARED_WORDS["componentWords"]
        assert list(EFFECT_WORDS) == SHARED_WORDS["effectWords"]

    def test_fake_effect_word_takes_effect(self):
        """证明是"读取"而非"抄写"：给加载结果追加假词 → 判定行为跟着变。"""
        from app.services import design_guard

        design_guard.EFFECT_WORDS.append("测试假效果")
        try:
            assert design_guard.is_design_request("给按钮加测试假效果") is True
        finally:
            design_guard.EFFECT_WORDS.remove("测试假效果")
        assert design_guard.is_design_request("给按钮加测试假效果") is False

    def test_fake_component_word_takes_effect(self):
        from app.services import design_guard

        design_guard.COMPONENT_WORDS.append("测试假组件")
        try:
            assert design_guard.is_design_request("测试假组件加阴影") is True
        finally:
            design_guard.COMPONENT_WORDS.remove("测试假组件")
        assert design_guard.is_design_request("测试假组件加阴影") is False
