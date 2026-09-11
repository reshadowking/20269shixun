"""AI 生成接口（v2.2 §9.2：POST /api/generate + GET /api/generate/templates + POST /api/check-compliance + 追问分析）。"""
from dataclasses import asdict

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator

from ..security import get_current_user
from ..services.compliance import compliance_rate, enforce_compliance
from ..services.design_guard import GUARD_REPLY, is_design_request
from ..services.generate import generate_design
from ..services.questions import FOLLOWUP_MODES, analyze_questions
from ..services.templates import TEMPLATE_KEYS

router = APIRouter(tags=["generate"])


class GenerateRequest(BaseModel):
    # 上限 8000 字符：超长需求先进长提示词摘要（>400 字符），不再被接口直接拒绝
    prompt: str = Field(min_length=1, max_length=8000)
    design_system: str = Field(default="brand-design-token-23v1", max_length=100)
    # P0-1 增量编辑：传入当前画布树时，走"只改指定部分"的增量修改模式
    design: dict | None = None


class GenerateResponse(BaseModel):
    design: dict
    template: str
    compliance: float
    violations: int
    style_attrs: int
    fallback: bool
    # 演示模式产出（未配置模型 Key：模板稿即演示稿）——前端须与模型产物显式区分
    mock: bool = False
    error: str = ""
    # B2-2：逐项合规拉回明细 [{node_id, field, original, corrected}]（前端逐项报告/还原用）
    violations_detail: list = []


@router.post("/api/generate", response_model=GenerateResponse)
def generate(req: GenerateRequest, _user: str = Depends(get_current_user)):
    """自然语言生成设计稿（意图解析 + 模板匹配 + 参数填充 + 合规检查）。"""
    # 缺陷 9：角色边界——无关请求礼貌拒答（防绕过）
    if not is_design_request(req.prompt):
        raise HTTPException(status_code=422, detail=GUARD_REPLY)
    try:
        result = generate_design(req.prompt, current_design=req.design)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"AI 生成失败：{exc}") from exc
    return GenerateResponse(
        design=result.design,
        template=result.template,
        compliance=result.compliance,
        violations=result.violations,
        style_attrs=result.style_attrs,
        fallback=result.fallback,
        mock=result.mock,
        error=result.error,
        violations_detail=result.violations_detail,
    )


@router.get("/api/generate/templates")
def list_templates(_user: str = Depends(get_current_user)):
    """模板列表（启动页选择用）。"""

    return {"templates": [{"key": k, "name": TEMPLATE_NAMES.get(k, k)} for k in TEMPLATE_KEYS]}


TEMPLATE_NAMES = {
    "login": "登录页", "landing": "落地营销页", "ecommerce": "电商优惠券页",
    "dashboard": "数据仪表板", "form": "表单登记页", "list": "列表管理页",
    "profile": "个人主页", "article": "文章详情页",
}


@router.get("/api/generate/templates/{name}")
def get_template(name: str, _user: str = Depends(get_current_user)):
    """返回指定模板的完整 DesignNode（启动页"以模板为起点"）。"""
    from ..services.templates import TEMPLATES

    if name not in TEMPLATES:
        raise HTTPException(status_code=404, detail=f"模板不存在: {name}")
    return {"template": name, "name": TEMPLATE_NAMES.get(name, name), "design": TEMPLATES[name]}


class QuestionsRequest(BaseModel):
    prompt: str = Field(min_length=1, max_length=8000)
    mode: str = Field(default="smart", max_length=20)
    # P0-1：增量修改场景（画布已有设计）不追问——用户是在改现有设计，不是新设计
    has_design: bool = False

    @field_validator("prompt")
    @classmethod
    def _not_blank(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("prompt 不能为空")
        return v


@router.post("/api/generate/questions")
def get_questions(req: QuestionsRequest, _user: str = Depends(get_current_user)):
    """追问分析（Q1-Q5）：按 4 档模式返回需追问的问题列表；无问题则直接生成。"""
    if req.mode not in FOLLOWUP_MODES:
        raise HTTPException(status_code=422, detail=f"mode 必须是 {'/'.join(FOLLOWUP_MODES)} 之一")
    # 缺陷 9：角色边界（增量修改 has_design 时放行——改现有设计必是设计请求）
    if not req.has_design and not is_design_request(req.prompt):
        raise HTTPException(status_code=422, detail=GUARD_REPLY)
    if req.has_design:
        return {"questions": [], "page_type": None, "style_known": True, "mode": req.mode}
    analysis = analyze_questions(req.prompt, req.mode)
    return {
        "questions": [asdict(q) for q in analysis.questions],
        "page_type": analysis.page_type,
        "style_known": analysis.style_known,
        "mode": analysis.mode,
    }


class ComplianceRequest(BaseModel):
    design: dict


@router.post("/api/check-compliance")
def check_compliance(req: ComplianceRequest, _user: str = Depends(get_current_user)):
    """独立合规检查接口（生成时自动执行，此接口供演示：展示拦截拉回与逐项明细）。"""
    from dataclasses import asdict

    design, fixes, total = enforce_compliance(req.design)
    violations = len(fixes)
    return {
        "design": design,
        "violations": violations,
        "style_attrs": total,
        "compliance": compliance_rate(violations, total),
        "violations_detail": [asdict(f) for f in fixes],
    }


class ExploreRequest(BaseModel):
    # 与 GenerateRequest 同约束：超长需求由长提示词摘要兜底
    prompt: str = Field(min_length=1, max_length=8000)
    design_system: str = Field(default="brand-design-token-23v1", max_length=100)


@router.post("/api/generate/explore")
async def explore_options(req: ExploreRequest, _user: str = Depends(get_current_user)):
    """D3 最小版：并行生成 2 份不同风格方案（复用 /api/generate 单段生成链路，不构成两段式）。

    方案二在提示词上附加差异化风格约束；两次调用线程池并行，总耗时接近单次。
    任一方案降级（mock/失败走模板稿）时标记 degraded；两份都保证合法可保存。
    若单次生成本身超 30s 预算，降级策略：保留至少一份可用方案并回填 degraded=true。
    """
    import asyncio

    if not is_design_request(req.prompt):
        raise HTTPException(status_code=422, detail=GUARD_REPLY)
    variants = [
        ("方案一 · 默认风格", req.prompt),
        (
            "方案二 · 差异化风格",
            (
                f"{req.prompt}。请使用与默认方案明显不同的配色与布局风格"
                "（例如深色/高对比主题、不同主色、不同结构组织），内容要点保持一致。"
            ),
        ),
    ]
    results = await asyncio.gather(*(asyncio.to_thread(generate_design, prompt) for _, prompt in variants))
    options = []
    degraded = False
    for (label, _), result in zip(variants, results):
        if result.fallback:
            degraded = True
        options.append(
            {
                "label": label,
                "design": result.design,
                "template": result.template,
                "compliance": result.compliance,
                "violations": result.violations,
                # 缺陷 1：逐方案来源标记——降级（fallback）与演示模板稿（mock）都必须能与模型产物区分
                "fallback": result.fallback,
                "mock": result.mock,
            }
        )
    return {"options": options, "degraded": degraded}
