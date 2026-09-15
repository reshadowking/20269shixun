"""最简 JWT 登录（v2.2 §9.4）。"""
import logging

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..config import get_settings
from ..db import get_db
from ..models import User
from ..security import create_token, get_current_user, hash_password, verify_password_full

logger = logging.getLogger(__name__)

router = APIRouter(tags=["auth"])


class LoginRequest(BaseModel):
    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=1, max_length=128)


class LoginResponse(BaseModel):
    token: str
    username: str


@router.get("/api/auth/me")
def me(_user: str = Depends(get_current_user)):
    """当前凭证对应的用户名（前端启动校验：token 失效时立即跳登录页）。

    消除"看着已登录、实际请求全 401"的中间态；配合前端 401 统一处理（清凭证 + 跳转）。
    """
    return {"username": _user}


@router.post("/api/auth/login", response_model=LoginResponse)
def login(req: LoginRequest, db: Session = Depends(get_db)):
    settings = get_settings()
    # 演示固定账号：首次登录自动建号
    user = db.query(User).filter(User.username == req.username).first()
    if user is None and req.username == settings.demo_user and req.password == settings.demo_password:
        user = User(username=req.username, password_hash=hash_password(req.password))
        db.add(user)
        db.commit()
        db.refresh(user)
    if user is None:
        raise HTTPException(status_code=401, detail="用户名或密码错误")
    ok, used_legacy_salt = verify_password_full(req.password, user.password_hash)
    if not ok:
        raise HTTPException(status_code=401, detail="用户名或密码错误")
    if used_legacy_salt:
        # 历史盐（旧实现以 jwt_secret 为盐）命中：改写成当前盐的哈希，避免轮换密钥后被锁在门外
        user.password_hash = hash_password(req.password)
        db.commit()
        logger.info("已升级账号 %s 的口令哈希到当前盐（jwt_secret 轮换后的平滑迁移）", user.username)
    return LoginResponse(token=create_token(req.username), username=req.username)
