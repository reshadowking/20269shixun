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


# 开发者在「API 配置」页保存的真实配置文件路径（测试绝不允许触碰）
_REAL_LLM_CONFIG: Path | None = None


@pytest.fixture(scope="session", autouse=True)
def _isolate_llm_runtime_config(tmp_path_factory):
    """把运行时 LLM 配置重定向到临时文件。

    事故背景：原做法是每个用例后 unlink **真实**配置文件，跑一次全量 pytest 就会把开发者在
    「API 配置」页保存的 Key / 模型 / Base URL 清掉（backend/data/llm-config.json 不入 git，
    删了无法恢复）。改为会话级临时路径：测试之间仍隔离，但绝不触碰开发者数据。
    """
    global _REAL_LLM_CONFIG
    from app import llm_runtime

    _REAL_LLM_CONFIG = llm_runtime.CONFIG_FILE
    llm_runtime.CONFIG_FILE = tmp_path_factory.mktemp("llm-runtime") / "llm-config.json"
    llm_runtime._load_from_disk.cache_clear()
    yield
    llm_runtime.CONFIG_FILE = _REAL_LLM_CONFIG
    llm_runtime._load_from_disk.cache_clear()


@pytest.fixture(autouse=True)
def _clean_llm_runtime_config():
    """每个测试后清理**测试用**运行时配置（隔离测试，避免互相污染）。"""
    yield
    from app.llm_runtime import CONFIG_FILE, _load_from_disk

    if CONFIG_FILE == _REAL_LLM_CONFIG:  # 防御：宁可直接报红，也不删开发者真实配置
        raise AssertionError("测试禁止删除开发者的真实 LLM 配置：请检查 conftest 的路径重定向")
    CONFIG_FILE.unlink(missing_ok=True)
    _load_from_disk.cache_clear()
