"""E3 智能辅助接口：布局优化（E3-2）+ 组件推荐（E3-3）。"""
from fastapi import APIRouter, Depends, HTTPException

from ..security import get_current_user
from pydantic import BaseModel

from ..services.optimizer import optimize_layout
from ..services.recommender import recommend_components

router = APIRouter(tags=["assist"])


class OptimizeRequest(BaseModel):
    design: dict


@router.post("/api/optimize-layout")
def optimize(req: OptimizeRequest, _user: str = Depends(get_current_user)):
    """智能布局优化：统一间距/对齐/大小（只改布局属性，内容与颜色不动）。"""
    design, report = optimize_layout(req.design)
    return {"design": design, "report": report}


class RecommendRequest(BaseModel):
    design: dict
    container_id: str


@router.post("/api/recommend-components")
def recommend(req: RecommendRequest, _user: str = Depends(get_current_user)):
    """组件智能推荐：按容器上下文推荐 3 个组件（含插入位置与默认属性）。"""
    recs = recommend_components(req.design, req.container_id)
    if not recs:
        raise HTTPException(status_code=404, detail="容器不存在或不可添加组件")
    return {"recommendations": recs}
