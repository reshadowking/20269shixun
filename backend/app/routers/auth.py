"""最简 JWT 登录（v2.2 §9.4）。"""
import logging

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..config import get_settings
from ..db import get_db
from ..models import User
from ..security import create_token, get_current_user, hash_password, verify_password_full
from ..services import rate_limit
from ..services.rate_limit import RateLimited
from ..services.workspaces import create_personal_workspace

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


class RegisterRequest(BaseModel):
    username: str = Field(min_length=3, max_length=64, pattern="^[A-Za-z0-9_-]+$")
    password: str = Field(min_length=6, max_length=128)


@router.post("/api/auth/register", response_model=LoginResponse)
def register(req: RegisterRequest, db: Session = Depends(get_db)):
    """T46a：开放注册——建用户 + **个人工作区**（owner），并直接返回 token。"""
    if db.query(User).filter(User.username == req.username).first() is not None:
        raise HTTPException(status_code=409, detail="用户名已被占用")
    user = User(username=req.username, password_hash=hash_password(req.password))
    db.add(user)
    try:
        db.commit()
    except IntegrityError:
        # 竞态：两个请求同时通过上面的存在性检查，后到的那条撞 Users.username 唯一约束。
        # 之前这里没有捕获 → 未处理异常（HTTP 500，前端也拿不到"重名"这个可读原因）。
        # 与同项目其它写入点对齐（建文件夹 / 保存版本号 / 幂等建会话都是捕获后给 409 或幂等）。
        # rollback 必须做：失败的 INSERT 已经污染了这个会话。
        db.rollback()
        raise HTTPException(status_code=409, detail="用户名已被占用") from None
    db.refresh(user)
    create_personal_workspace(db, user.id, user.username)
    logger.info("新用户注册：%s（已创建个人工作区）", user.username)
    return LoginResponse(token=create_token(req.username), username=req.username)


@router.post("/api/auth/login", response_model=LoginResponse)
def login(req: LoginRequest, request: Request, db: Session = Depends(get_db)):
    """登录。2026-09-17：补上凭证尝试限流——此前 `/api/auth/login` 完全没有限制，
    口令可被无限次高速猜测（生成接口早就有 rate_limit，登录口漏了）。"""
    settings = get_settings()
    # 按 ip + 用户名限流：只对**失败**计费，所以正常登录不受影响
    # （key 带 ip 是为了避免"任何人刷错口令就能把别人的账号锁一分钟"）。
    client_ip = request.client.host if request.client else "unknown"
    limit_key = f"{client_ip}|{req.username}"
    try:
        rate_limit.check_login(limit_key)
    except RateLimited as exc:
        raise HTTPException(status_code=429, detail=str(exc)) from exc
    # 演示固定账号：首次登录自动建号
    user = db.query(User).filter(User.username == req.username).first()
    if user is None and req.username == settings.demo_user and req.password == settings.demo_password:
        user = User(username=req.username, password_hash=hash_password(req.password))
        db.add(user)
        try:
            db.commit()
        except IntegrityError:
            # 竞态：全新库上两个请求**同时**首次登录 demo（快捷建号）→ 撞 users.username。
            # 回滚后重查即可：账号已被对方建好，口令就是同一份配置口令，继续走校验即可。
            db.rollback()
            user = db.query(User).filter(User.username == req.username).first()
            if user is None:
                raise  # 不是可恢复冲突 → 原样抛出
        else:
            db.refresh(user)
    if user is None:
        rate_limit.note_login_failure(limit_key)
        raise HTTPException(status_code=401, detail="用户名或密码错误")
    ok, used_legacy_salt = verify_password_full(req.password, user.password_hash)
    if not ok:
        rate_limit.note_login_failure(limit_key)
        raise HTTPException(status_code=401, detail="用户名或密码错误")
    # 凭证正确：清掉该 key 的失败计数，避免"手滑几次之后连自己都被挡"
    rate_limit.clear_login_failures(limit_key)
    if used_legacy_salt:
        # 历史盐（旧实现以 jwt_secret 为盐）命中：改写成当前盐的哈希，避免轮换密钥后被锁在门外
        user.password_hash = hash_password(req.password)
        db.commit()
        logger.info("已升级账号 %s 的口令哈希到当前盐（jwt_secret 轮换后的平滑迁移）", user.username)
    # 2026-09-17：演示账号登录时确保它有**个人工作区**（幂等，已存在直接返回）。
    # 踩过：注册路径建了个人工作区，而"首次登录自动建号"这条没建 —— 在**全新库**
    # （docker compose 新 volume / 新同事 / CI）上 demo 登录后 `/api/workspaces` 是空的，
    # 邀请协作、按工作区看稿这些入口没有落脚点（E2E `readonly-drag` 的前置就是这么红的）。
    if req.username == settings.demo_user:
        create_personal_workspace(db, user.id, user.username)
    return LoginResponse(token=create_token(req.username), username=req.username)
