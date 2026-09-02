"""鉴权测试（P1-10）：业务接口必须携带有效 token，否则 401。"""


class TestAuthRequired:
    def test_generate_requires_token(self, client):
        resp = client.post("/api/generate", json={"prompt": "登录页"})
        assert resp.status_code == 401

    def test_generate_questions_requires_token(self, client):
        resp = client.post("/api/generate/questions", json={"prompt": "登录页"})
        assert resp.status_code == 401

    def test_generate_templates_requires_token(self, client):
        assert client.get("/api/generate/templates").status_code == 401

    def test_check_compliance_requires_token(self, client):
        resp = client.post("/api/check-compliance", json={"design": {"id": "x", "type": "text"}})
        assert resp.status_code == 401

    def test_optimize_requires_token(self, client):
        resp = client.post("/api/optimize-layout", json={"design": {"id": "x", "type": "frame"}})
        assert resp.status_code == 401

    def test_recommend_requires_token(self, client):
        resp = client.post("/api/recommend-components", json={"design": {"id": "x", "type": "frame"}, "container_id": "x"})
        assert resp.status_code == 401

    def test_tokens_requires_token(self, client):
        assert client.get("/api/tokens").status_code == 401

    def test_llm_config_requires_token(self, client):
        assert client.get("/api/llm-config").status_code == 401
        assert client.post("/api/llm-config", json={"llm_model": "x"}).status_code == 401
        assert client.post("/api/llm-config/test", json={}).status_code == 401

    def test_health_public(self, client):
        assert client.get("/api/health").status_code == 200


class TestAuthWithToken:
    def test_generate_with_token_works(self, client, auth_headers):
        resp = client.post("/api/generate", json={"prompt": "登录页"}, headers=auth_headers)
        assert resp.status_code == 200

    def test_invalid_token_rejected(self, client):
        resp = client.post(
            "/api/generate",
            json={"prompt": "登录页"},
            headers={"Authorization": "Bearer invalid.token.here"},
        )
        assert resp.status_code == 401
