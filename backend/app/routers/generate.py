"""AI 生成接口（v2.2 §9.2：POST /api/generate + GET /api/generate/templates + POST /api/check-compliance + 追问分析）。"""
from dataclasses import asdict

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.orm import Session as DbSession

from ..config import get_settings
from ..db import get_db
from ..security import get_current_user
from ..services.ai_gateway import GatewayBusy, GenerationDeadline, run_generation
from ..services.ai_ledger import record_calls
from ..services.compliance import compliance_rate, enforce_compliance
from ..services.design_guard import GUARD_REPLY, is_design_request
from ..services.generate import generate_design
from ..services.history import recent_turns
from ..services.questions import FOLLOWUP_MODES, analyze_questions
from ..services.templates import TEMPLATE_KEYS

router = APIRouter(tags=["generate"])


class GenerateRequest(BaseModel):
    # 上限 8000 字符：超长需求先进长提示词摘要（>400 字符），不再被接口直接拒绝
    prompt: str = Field(min_length=1, max_length=8000)
    design_system: str = Field(default="brand-design-token-23v1", max_length=100)
    # P0-1 增量编辑：传入当前画布树时，走"只改指定部分"的增量修改模式
    design: dict | None = None
    # T4 批2：仅用于增量提示词措辞（锁定阶段追加更严约束段），向后兼容（旧调用方不传即未锁定）。
    # ⚠️ 不是安全开关：锁定与否的权威判定在服务端闸门（/api/apply-locked-edit 按
    # design_locks 查表），不读本字段——客户端谎报 locked=false 只会让模型更可能
    # 产出被闸门拒绝的改动（体验变差），不构成绕过锁的安全漏洞。
    locked: bool = False
    # T24：会话 id（可选，向后兼容）——服务端据此取最近 2 轮历史（含上一轮指令原文）。
    # 与 T21 的记账复用同一字段；缺省/越权/不存在都会安全降级为"无历史"。
    session_key: str | None = Field(default=None, max_length=64)


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
    # T8：本轮降级明细（["icon@节点id"]）——附加字段，前端聊天面板消费（T8 收尾）
    degraded: list = []


@router.post("/api/generate", response_model=GenerateResponse)
async def generate(req: GenerateRequest, _user: str = Depends(get_current_user), db: DbSession = Depends(get_db)):
    """自然语言生成设计稿（T20：专用线程池执行 + 并发闸门 + 整链路时间预算）。"""
    # 缺陷 9 + T10：角色边界分级——带 design 的增量修改不调守卫（「有设计稿且提要求」
    # 本来就该放行，§4.9 实测「加高级功能」被误拦）；首轮生成保持原有强度。
    if req.design is None and not is_design_request(req.prompt):
        raise HTTPException(status_code=422, detail=GUARD_REPLY)
    history = recent_turns(db, req.session_key, _user)
    deadline = GenerationDeadline(get_settings().llm_deadline_seconds)
    try:
        result = await run_generation(
            generate_design,
            req.prompt,
            current_design=req.design,
            locked=req.locked,
            history=history,
            deadline=deadline,
        )
    except GatewayBusy as exc:
        # 取不到槽位 = 没开始干活：503（与"干了但降级"的 200+fallback 语义区分）
        raise HTTPException(status_code=503, detail="当前生成任务较多，请稍后重试") from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"AI 生成失败：{exc}") from exc
    record_calls(result.ai_calls, req.session_key)  # T21：记账（内部吞异常，不影响返回）
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
        degraded=result.degraded,
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
    # T24：与 /api/generate 一致——可选会话 id，用于取最近 2 轮历史
    session_key: str | None = Field(default=None, max_length=64)


class ExploreOptionModel(BaseModel):
    """单个探索方案（T10/§4.10 #19：此前 explore 响应无 schema，机器可读契约盲区）。"""

    label: str
    design: dict
    template: str
    compliance: float
    violations: int
    fallback: bool
    mock: bool
    # T10 批2（缺口清单 §4.8 #16）：组件能力降级明细（命名避开顶层 degraded: bool）
    degraded_kinds: list[str] = []


class ExploreResponse(BaseModel):
    options: list[ExploreOptionModel]
    degraded: bool


@router.post("/api/generate/explore", response_model=ExploreResponse)
async def explore_options(req: ExploreRequest, _user: str = Depends(get_current_user), db: DbSession = Depends(get_db)):
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
    history = recent_turns(db, req.session_key, _user)
    deadline = GenerationDeadline(get_settings().llm_deadline_seconds)
    try:
        # 两方案各占一个生成槽位（专用池 ≥2 才能真并行；见 config.llm_max_concurrency 默认 4）
        results = await asyncio.gather(
            *(run_generation(generate_design, prompt, history=history, deadline=deadline) for _, prompt in variants)
        )
    except GatewayBusy as exc:
        raise HTTPException(status_code=503, detail="当前生成任务较多，请稍后重试") from exc
    options = []
    degraded = False
    for result in results:
        record_calls(result.ai_calls, req.session_key)  # T21：两方案各自记账
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
                # T10 批2（缺口清单 §4.8 #16）：组件能力降级明细随方案透传（命名避开顶层 degraded: bool）
                "degraded_kinds": result.degraded,
            }
        )
    return {"options": options, "degraded": degraded}
