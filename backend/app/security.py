"""最简 JWT 鉴权（v2.2 §9.4：演示固定账号，不做注册/角色）。"""
import base64
import hashlib
import hmac
import secrets
from datetime import UTC, datetime, timedelta

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from .config import get_settings

ALGORITHM = "HS256"

# Bearer token 提取器（P1-10 全量鉴权：业务接口统一走 get_current_user）
_bearer = HTTPBearer(auto_error=False)


def get_current_user(credentials: HTTPAuthorizationCredentials | None = Depends(_bearer)) -> str:
    """FastAPI 依赖：校验 Bearer token，返回用户名；缺失/无效抛 401。"""
    if credentials is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="未登录：请先调用 /api/auth/login")
    username = decode_token(credentials.credentials)
    if username is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="登录已过期或凭证无效，请重新登录")
    return username


# 旧实现用 jwt_secret 当口令哈希盐；一旦轮换密钥，所有口令哈希立即失效（用户被锁在门外）。
# 这里保留可识别的历史盐：命中即视为通过，并由调用方把哈希升级到当前盐（平滑迁移）。
_LEGACY_HASH_SALTS = ("dev-secret-change-me-please-32bytes-minimum", "change-me-in-production")


"""
口令哈希（2026-09-17 升级）。

旧方案 = **全局盐 + 单轮 SHA-256**（`sha256(password_salt + "::" + 口令)`）：
① 所有账号同一个口令就是同一个哈希 —— 彩虹表/撞库直接可用；
② 单轮 SHA-256 在 GPU 上每秒几十亿次 —— 拿到库基本等于拿到明文口令。

新方案 = **PBKDF2-HMAC-SHA256 + 每用户随机盐 + 迭代数**（标准库自带，不必引 bcrypt 依赖）。
哈希串自描述：`pbkdf2_sha256$<迭代数>$<盐 base64url>$<摘要 base64url>`，
校验只需要这一串本身（不依赖任何配置）。

兼容：旧哈希（64 位十六进制、无前缀）继续可验证，并在**下次成功登录**时自动重写成新格式
—— 复用既有的 `used_legacy` 迁移通道（`routers/auth.py` 命中即重写 `password_hash`），
所以现存账号不需要任何手工迁移。
"""
PBKDF2_PREFIX = "pbkdf2_sha256"
SALT_BYTES = 16


def _b64(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def _unb64(text: str) -> bytes | None:
    try:
        return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))
    except Exception:  # noqa: BLE001 —— 畸形哈希一律当"校验失败"，不能让登录 500
        return None


def hash_password(password: str) -> str:
    """新方案哈希：每用户随机盐 + PBKDF2（迭代数可配，默认 600k）。"""
    iterations = max(1, int(get_settings().password_hash_iterations))
    salt = secrets.token_bytes(SALT_BYTES)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, iterations)
    return f"{PBKDF2_PREFIX}${iterations}${_b64(salt)}${_b64(digest)}"


def _verify_pbkdf2(password: str, stored: str) -> bool:
    """按哈希串里自带的算法参数复算并**常量时间**比较；任何畸形输入都返回 False（不抛）。"""
    prefix, _, rest = stored.partition("$")
    if prefix != PBKDF2_PREFIX:
        return False
    iterations_text, _, rest = rest.partition("$")
    salt_text, _, digest_text = rest.partition("$")
    salt = _unb64(salt_text)
    expected = _unb64(digest_text)
    if salt is None or expected is None:
        return False
    try:
        iterations = int(iterations_text)
    except ValueError:
        return False
    if iterations < 1:
        return False
    actual = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, iterations)
    return hmac.compare_digest(actual, expected)


def _hash_with_salt(password: str, salt: str) -> str:
    return hashlib.sha256(f"{salt}::{password}".encode()).hexdigest()


def verify_password_full(password: str, password_hash: str) -> tuple[bool, bool]:
    """校验口令，返回 (是否通过, 是否走了历史盐)。

    历史盐命中 → 调用方应把 user.password_hash 重写为 hash_password(password) 完成升级。

    2026-09-17：比较改成 `hmac.compare_digest`（常量时间）。`==` 是短路比较，
    理论上可被逐字节测出哈希前缀；口令哈希比较没有理由不用常量时间——
    与 `routers/images.py` 的公开链接凭证、`routers/collab.py` 的内网令牌同一口径。
    同日起：新方案走 `_verify_pbkdf2`；旧方案的三种盐都算"需要升级"。
    """
    if password_hash.startswith(PBKDF2_PREFIX + "$"):
        return _verify_pbkdf2(password, password_hash), False
    # 旧方案（全局盐 / jwt_secret / 历史硬编码盐）：命中即通过，并请调用方升级
    settings = get_settings()
    for salt in (settings.password_salt, settings.jwt_secret, *_LEGACY_HASH_SALTS):
        if hmac.compare_digest(_hash_with_salt(password, salt), password_hash):
            return True, True
    return False, False


def verify_password(password: str, password_hash: str) -> bool:
    return verify_password_full(password, password_hash)[0]


def create_token(username: str) -> str:
    settings = get_settings()
    payload = {
        "sub": username,
        "exp": datetime.now(UTC) + timedelta(hours=settings.jwt_expire_hours),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=ALGORITHM)


def decode_token(token: str) -> str | None:
    """返回用户名；无效/过期返回 None。"""
    try:
        payload = jwt.decode(token, get_settings().jwt_secret, algorithms=[ALGORITHM])
        return payload.get("sub")
    except jwt.PyJWTError:
        return None
