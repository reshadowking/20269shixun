"""E3 智能辅助接口：布局优化（E3-2）+ 组件推荐（E3-3）+ 美化效果（缺陷 3 / T4 批3 批量）。"""
import copy

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

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


class BatchTarget(BaseModel):
    node_id: str
    effects: dict


class ApplyEffectsBatchRequest(BaseModel):
    design: dict
    # T4 批3：批量写入只新增端点，不放宽/不改动单人端点的任何行为
    targets: list[BatchTarget] = Field(min_length=1)


@router.post("/api/apply-effects/batch")
def apply_beautify_effects_batch(req: ApplyEffectsBatchRequest, _user: str = Depends(get_current_user)):
    """批量美化效果写入（T4 批3）：多 target 一次提交，原子生效。

    原子性取舍（§4-1-2/3）：预校验式整批事务——逐 target 复用 apply_effects() 在副本上
    顺序写入，任一 target 非法（白名单外 / 非预置值 / 节点不存在）即整批 422、不返回
    半应用的树。选择整批拒绝而非记入 failed：与前端 updateMany 的原子语义一致，
    避免"半应用 + 撤销只回退一半"；白名单判定仍只有 apply_effects 一个执行点，
    本端点不复制第二份判定逻辑。响应保留 failed 字段（原子语义下恒为空），
    供契约稳定与前端防御性处理。
    """
    tree = copy.deepcopy(req.design)
    applied: list[str] = []
    removed: list[str] = []
    changes_size = False
    for i, target in enumerate(req.targets):
        try:
            result = apply_effects(tree, target.node_id, target.effects)
        except EffectError as exc:
            detail = f"第 {i + 1}/{len(req.targets)} 个 target（{target.node_id}）被拒绝：{exc}"
            raise HTTPException(status_code=422, detail=detail) from exc
        tree = result.design
        applied.extend(f"{target.node_id}.{key}" for key in result.applied)
        removed.extend(f"{target.node_id}.{key}" for key in result.removed)
        changes_size = changes_size or result.changes_size
    return {
        "design": tree,
        "applied": applied,
        "removed": removed,
        "changes_size": changes_size,
        "failed": [],
    }
