"""pytest 全局配置：测试用 SQLite 内存库，隔离开发/生产数据库。"""
import os
import sys
from pathlib import Path

# 必须在导入 app 之前设置：所有模块级 engine 都基于此 URL
os.environ["PG_URL"] = "sqlite:///./test_ai_native.db"
os.environ["LLM_MODE"] = "mock"

BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))

import pytest
from fastapi.testclient import TestClient

from app.main import app


@pytest.fixture(scope="session", autouse=True)
def _clean_db():
    """每个测试会话开始前清空数据库文件，保证可复跑。"""
    db_file = BACKEND / "test_ai_native.db"
    if db_file.exists():
        db_file.unlink()
    yield


@pytest.fixture()
def client():
    with TestClient(app) as c:
        yield c


@pytest.fixture()
def auth_headers(client):
    resp = client.post("/api/auth/login", json={"username": "demo", "password": "demo123"})
    assert resp.status_code == 200
    return {"Authorization": f"Bearer {resp.json()['token']}"}


@pytest.fixture(autouse=True)
def _clean_llm_runtime_config():
    """每个测试后清理前端保存的 LLM 运行时配置（隔离测试，避免互相污染）。"""
    yield
    from app.llm_runtime import CONFIG_FILE, _load_from_disk

    CONFIG_FILE.unlink(missing_ok=True)
    _load_from_disk.cache_clear()
