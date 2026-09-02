"""令牌库接口（v2.2 §9.2：GET /api/tokens）。"""
from fastapi import APIRouter, Depends

from ..design import tokens
from ..security import get_current_user

router = APIRouter(tags=["tokens"])


@router.get("/api/tokens")
def get_tokens(_user: str = Depends(get_current_user)):
    """返回当前令牌库（含主题列表与白名单），供画布解析器与合规检查使用。"""
    return {
        "themes": tokens.THEMES,
        "colors": tokens.COLORS,
        "typography": tokens.TYPOGRAPHY,
        "spacing": tokens.SPACING,
        "radius": tokens.RADIUS,
        "allowed_hex_colors": tokens.ALLOWED_HEX_COLORS,
    }
