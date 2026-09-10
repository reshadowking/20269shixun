"""最简 JWT 鉴权（v2.2 §9.4：演示固定账号，不做注册/角色）。"""
import hashlib
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


def hash_password(password: str) -> str:
    """演示级哈希（非生产标准，二期换 bcrypt）。盐独立于 jwt_secret，轮换密钥不影响口令。"""
    return hashlib.sha256(f"{get_settings().password_salt}::{password}".encode()).hexdigest()


def _hash_with_salt(password: str, salt: str) -> str:
    return hashlib.sha256(f"{salt}::{password}".encode()).hexdigest()


def verify_password_full(password: str, password_hash: str) -> tuple[bool, bool]:
    """校验口令，返回 (是否通过, 是否走了历史盐)。

    历史盐命中 → 调用方应把 user.password_hash 重写为 hash_password(password) 完成升级。
    """
    if hash_password(password) == password_hash:
        return True, False
    settings = get_settings()
    for salt in (settings.jwt_secret, *_LEGACY_HASH_SALTS):
        if _hash_with_salt(password, salt) == password_hash:
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
