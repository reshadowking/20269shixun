"""全局配置：从 .env / 环境变量读取，全部有本机开发兜底值。"""
from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BASE_DIR = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=str(BASE_DIR / ".env"), extra="ignore")

    # LLM（用户自填 key；填之前用 mock 模式）
    llm_mode: str = "mock"  # mock | real
    llm_base_url: str = "https://api.deepseek.com/v1"
    llm_api_key: str = ""
    llm_model: str = "deepseek-v4-flash"
    llm_backup_model: str = "deepseek-v4-flash"
    llm_timeout_seconds: float = 60.0  # 复杂需求（多模块落地页）生成需时较长，30s 会误杀
    llm_max_tokens: int = 16384  # 输出上限：42K 字符的完整 DesignNode 树 ≈ 8200 token，8192 会截断（finish_reason=length）
    llm_temperature_parse: float = 0.2
    llm_temperature_fill: float = 0.6  # 0.3 太死板（相同提示词结果雷同），0.6 平衡多样与稳定
    llm_history_max_chars: int = 1200  # T24：会话历史进提示词的字符预算（超出丢最旧一轮）
    # T20：生成网关——专用池大小 / 排队等待 / 整链路时间预算 / 单次调用最低预算
    llm_max_concurrency: int = 4
    llm_queue_timeout_seconds: float = 5.0
    llm_deadline_seconds: float = 45.0
    llm_min_call_budget_seconds: float = 5.0
    # T23 对照用：是否在增量提示词里启用 ops 输出形态（0 = 强制旧的整树输出，用于 A/B 评估）
    prompt_ops_enabled: bool = True
    # T22：熔断与限流/配额（进程内实现；0 表示不限制）
    ai_breaker_fail_ratio: float = 0.6
    ai_breaker_min_samples: int = 5
    ai_breaker_open_seconds: float = 30.0
    ai_rate_limit_per_minute: int = 10
    ai_global_rate_limit_per_minute: int = 60
    # 登录/注册凭证尝试的限流（按 ip+用户名；0 = 不限制）。只对**失败**计费，
    # 所以正常登录不受影响，靠刷口令的暴力破解会在几十次之后被 429 挡住。
    login_rate_limit_per_minute: int = 20
    # 口令哈希的 PBKDF2 迭代数（2026-09-17：口令哈希从"全局盐+单轮 SHA-256"升级为
    # PBKDF2-HMAC-SHA256 + 每用户随机盐）。600k 是本机约 110ms、OWASP 对
    # PBKDF2-HMAC-SHA256 的推荐值；测试里由 conftest 压到 1k 以免拖慢套件。
    # 注意：迭代数**写进哈希串**，改这个值只影响新写入的哈希，旧哈希照旧可验证。
    password_hash_iterations: int = 600000
    # 注册限流（按 ip；0 = 不限制）。与登录口的区别：**每次调用都计费**——注册是"建号"，
    # 光拦失败没有意义（批量建号本身就是攻击面）。30/min 对正常用户（注册一次）等于不限，
    # 对脚本则很快打满。
    register_rate_limit_per_minute: int = 30
    ai_daily_token_quota: int = 200000
    ai_daily_token_quota_per_user: int = 50000

    # 数据库（测试用 sqlite 覆盖此值）
    pg_url: str = "postgresql+psycopg://postgres:postgres@localhost:5432/design"
    redis_url: str = "redis://localhost:6380/0"

    # 存储
    storage_root: str = str(BASE_DIR / "designs" / "images")

    # 鉴权（默认值仅本机开发兜底，生产必须 .env 覆盖；≥32 字节防 RFC7518 警告）
    jwt_secret: str = "dev-secret-change-me-please-32bytes-minimum"
    jwt_expire_hours: int = 24
    # 口令哈希盐（与 jwt_secret 解耦：轮换 JWT 密钥不应该让所有口令失效——见 P1-1 事故）
    password_salt: str = "design-tool-demo-hash-salt-v1"
    demo_user: str = "demo"
    demo_password: str = "demo123"

    # 可观测
    otel_exporter_otlp_endpoint: str = "http://localhost:4318"

    # 生成链路日志目录（generate.log，分析生成失败）
    log_dir: str = str(BASE_DIR / "logs")

    # 端口
    backend_port: int = 8000
    y_websocket_url: str = "ws://localhost:1234"
    # T46a-3：协作鉴权网关的内网令牌（网关调 /api/collab/authorize 时必须带上；空 = 该接口关闭）
    collab_internal_token: str = ""


@lru_cache
def get_settings() -> Settings:
    return Settings()
