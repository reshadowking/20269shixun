"""T51：AI 效果反馈接口（变更清单卡片的 👍/👎）。

为什么需要：用户说"效果不好"时，我们无法知道是**哪一类**（结构/样式/审美/没生效/越改越差）
——没有这个闭环，链路优化就是盲调。反馈是卡片级（category 单选，note 补足），归因字段
（model/prompt_version/profile_id/api_format）来自那次生成的响应。

**失败绝不静默**：落库失败必须返回 5xx 让前端提示"提交失败，可重试"——
静默失败会让数据变脏，后面所有汇总都不可信。
"""
import logging

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator

from ..db import SessionLocal
from ..models import AiFeedback
from ..security import get_current_user

logger = logging.getLogger(__name__)
router = APIRouter(tags=["feedback"])

FEEDBACK_CATEGORIES = ("structure", "style", "aesthetic", "not_applied", "worse")


class FeedbackCreate(BaseModel):
    """卡片级反馈：rating(±1) + category 单选 + note 补足；归因字段来自那次生成的响应。"""

    rating: int
    category: str = Field(default="", max_length=16)
    note: str | None = Field(default=None, max_length=500)
    session_key: str | None = Field(default=None, max_length=64)
    llm_model: str | None = Field(default=None, max_length=64)
    prompt_version: str | None = Field(default=None, max_length=16)
    profile_id: str | None = Field(default=None, max_length=32)
    api_format: str | None = Field(default=None, max_length=16)

    @field_validator("rating")
    @classmethod
    def _validate_rating(cls, value: int) -> int:
        if value not in (1, -1):
            raise ValueError("rating 只能是 +1 或 -1")
        return value

    @field_validator("category")
    @classmethod
    def _validate_category(cls, value: str) -> str:
        if value and value not in FEEDBACK_CATEGORIES:
            raise ValueError(f"未知的反馈类别：{value}")
        return value


@router.post("/api/feedback")
def create_feedback(req: FeedbackCreate, _user: str = Depends(get_current_user)):
    """落一条反馈。失败必须显式报错——不能让用户以为记下了，其实没落库。"""
    try:
        db = SessionLocal()
        try:
            row = AiFeedback(
                user=_user,
                session_key=req.session_key,
                rating=req.rating,
                category=req.category,
                note=(req.note or "")[:500],
                llm_model=(req.llm_model or "")[:64],
                prompt_version=(req.prompt_version or "")[:16],
                profile_id=(req.profile_id or "")[:32],
                api_format=(req.api_format or "")[:16],
            )
            db.add(row)
            db.commit()
            return {"ok": True, "id": row.id}
        finally:
            db.close()
    except HTTPException:
        raise
    except Exception as exc:
        logger.warning("反馈落库失败：%s", exc)
        raise HTTPException(status_code=500, detail="反馈记录失败，请重试") from exc
