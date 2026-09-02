"""AI 角色边界守卫测试（缺陷 9）：无关请求拦截，设计请求放行。"""

from app.services.design_guard import GUARD_REPLY, is_design_request


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
        ]
        for prompt in blocked:
            assert not is_design_request(prompt), f"应拦截: {prompt}"


class TestGuardApi:
    def test_generate_blocked_with_guard_reply(self, client, auth_headers):
        resp = client.post("/api/generate", json={"prompt": "帮我写首诗"}, headers=auth_headers)
        assert resp.status_code == 422
        assert "AI 设计助手" in resp.json()["detail"]

    def test_generate_questions_blocked(self, client, auth_headers):
        resp = client.post("/api/generate/questions", json={"prompt": "今天天气怎么样"}, headers=auth_headers)
        assert resp.status_code == 422
        assert GUARD_REPLY in resp.json()["detail"]

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
