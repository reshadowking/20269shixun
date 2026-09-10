"""E3 智能辅助接口：布局优化（E3-2）+ 组件推荐（E3-3）+ 美化效果（缺陷 3）。"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from ..security import get_current_user
from ..services.beautify import EffectError, apply_effects
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


class ApplyEffectsRequest(BaseModel):
    design: dict
    node_id: str
    # 缺陷 3 美化阶段：只接受样式白名单 {key: 预置值}；null 表示移除该效果
    effects: dict


@router.post("/api/apply-effects")
def apply_beautify_effects(req: ApplyEffectsRequest, _user: str = Depends(get_current_user)):
    """美化效果写入（缺陷 3 铁闸）：白名单外的键（布局/结构/文本/尺寸）一律 422。

    这是"绕过 UI 直接构造请求"也会撞上的数据写入层：白名单与取值集合来自
    shared/beautify-effects.json（单一来源），非预置取值与未知键都不落库。
    """
    try:
        result = apply_effects(req.design, req.node_id, req.effects)
    except EffectError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {
        "design": result.design,
        "applied": result.applied,
        "removed": result.removed,
        "changes_size": result.changes_size,
    }
