"""最简 JWT 登录（v2.2 §9.4）。"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..config import get_settings
from ..db import get_db
from ..models import User
from ..security import create_token, hash_password, verify_password

router = APIRouter(tags=["auth"])


class LoginRequest(BaseModel):
    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=1, max_length=128)


class LoginResponse(BaseModel):
    token: str
    username: str


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
    if user is None or not verify_password(req.password, user.password_hash):
        raise HTTPException(status_code=401, detail="用户名或密码错误")
    return LoginResponse(token=create_token(req.username), username=req.username)
