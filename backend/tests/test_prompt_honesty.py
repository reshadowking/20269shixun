"""T53：提示词如实性护栏——"整稿被拒"的错误描述不得回流；icon 措辞与代码行为互锁。

背景（2026-09-19 语义 bug 修复）：三套 system 曾写"自创 componentType 会导致整稿被拒"，
真实行为是**节点级降级**（T8：未知组件降 frame、props 清除、可见文字抢救）——错误描述
会让模型对后果产生错误预期。护栏两条腿：
- 文本断言：错误短语在任何提示词面 0 次出现，准确短语每面恰 1 次；
- 行为断言：icon 未知名"只 warning 不进台账"——icon_prompt_section 的措辞与之互锁，
  代码行为变化时这里先红，提示词不会变成谎言。
"""
from app.services.generate import (
    _CONTRACT_VIOLATION_NOTE,
    FILL_SYSTEM,
    FREE_SYSTEM,
    INCREMENTAL_SYSTEM,
    PROMPT_VERSION_FILL,
    PROMPT_VERSION_FREE,
    PROMPT_VERSION_INCREMENTAL,
    component_contract_section,
    fill_system_text,
    icon_prompt_section,
    incremental_system,
    repair_design,
)
from app.services.llm import prompt_version

PROMPT_SURFACES = {
    "FILL": FILL_SYSTEM,
    "FREE": FREE_SYSTEM,
    "INCREMENTAL": INCREMENTAL_SYSTEM,
    "icon_prompt": icon_prompt_section(),
    "component_contract": component_contract_section(),
}

# 裸常量层钉值（批次 3 记录；常量抽取重构的逐字节保真证据）。
PINNED_BARE_SHA = {
    "FILL": "ae1a2dde1276",
    "FREE": "82c4d4328055",
    "INCREMENTAL": "8e004a526d4d",
}

# T3 静态组装层钉值（P0 体量上限注入后采样，2026-09-19）——启动打印/台账/golden 的版本口径。
# 演进：T3.1（注入前）FILL f8ac4fb3385a / FREE cf91eef2232f / INC 9700cf2fecea；
#      T3.2（注入后）INC 跳变为 5f2ea506dab8，FILL/FREE 不变（ops 段只在 INC 组装里）。
PINNED_STATIC_SHA = {
    "FILL": "f8ac4fb3385a",
    "FREE": "cf91eef2232f",
    "INCREMENTAL": "5f2ea506dab8",
}

# 组装层互锁（needs_form=True，golden 报告口径）：FILL 不含 ops 段故不变；INC 随体量上限跳变。
PINNED_ASSEMBLED_SHA = {
    "FILL(needs_form=True)": "1634560e3dff",
    "INCREMENTAL(locked=False,needs_form=True)": "c0285817fb5a",
}


def test_sha_pinned_bare_constants():
    """裸常量 sha 钉死（批次 3 记录值；常量抽取重构的逐字节保真证据）。FREE 的改动前 sha 未曾采样，
    本表钉的是改后值——改动前文本已不存在，回溯以 T53 报告的对照表为准。"""
    for name, sys_str in (("FILL", FILL_SYSTEM), ("FREE", FREE_SYSTEM), ("INCREMENTAL", INCREMENTAL_SYSTEM)):
        current = prompt_version(sys_str)
        assert current == PINNED_BARE_SHA[name], (
            f"SHA mismatch for {name}.\n"
            f"  Expected: {PINNED_BARE_SHA[name]}\n"
            f"  Current:  {current}\n"
            "If intentional, update PINNED_BARE_SHA in this test to the current value "
            "and sync the T53 report's data-source table."
        )


def test_prompt_version_constants_wired_to_pins():
    """启动打印/台账/golden 三处同源的接线断言：generate.py 的版本常量必须等于 T3.2 静态钉值。"""
    assert PROMPT_VERSION_FILL == PINNED_STATIC_SHA["FILL"]
    assert PROMPT_VERSION_FREE == PINNED_STATIC_SHA["FREE"]
    assert PROMPT_VERSION_INCREMENTAL == PINNED_STATIC_SHA["INCREMENTAL"]


def test_sha_pinned_assembled_golden_chain():
    """组装层互锁：golden 报告的 prompt_version 哈希的是组装后 system，不是裸常量。"""
    assert (
        prompt_version(fill_system_text(None, True)) == PINNED_ASSEMBLED_SHA["FILL(needs_form=True)"]
    ), "fill 组装层 sha 漂移——golden 对比链路断裂"
    assert (
        prompt_version(incremental_system(False, None, True))
        == PINNED_ASSEMBLED_SHA["INCREMENTAL(locked=False,needs_form=True)"]
    ), "incremental 组装层 sha 漂移——golden 对比链路断裂"


def test_contract_note_single_sourced():
    """单一来源的结构证据：源码中常量名出现**恰好 4 次**（1 定义 + 3 引用）。
    此断言依赖命名约定——注释/文档引用全称会让 count 变 5 而误红（注释写"该常量"即可）。
    手写字面量绕过常量也会让 count 变 4 但三套 system 缺失该文本 → 由 text 级断言兜底。"""
    import inspect

    from app.services import generate

    src = inspect.getsource(generate)
    assert src.count("_CONTRACT_VIOLATION_NOTE") == 4
    for name in ("FILL", "FREE", "INCREMENTAL"):
        assert _CONTRACT_VIOLATION_NOTE in PROMPT_SURFACES[name], name


def test_no_false_whole_design_rejection_claim():
    """真实行为是节点级降级，从未整稿拒绝——错误短语在五个提示词面 0 次出现。"""
    for name, surface in PROMPT_SURFACES.items():
        assert "会导致整稿被拒" not in surface, f"{name} 仍含错误描述「会导致整稿被拒」"


def test_honest_degrade_wording_once_per_system():
    """三套 system 各含一次准确措辞（与 _degrade_to_frame 实际行为逐项对应：
    组件参数丢失、布局样式保留、仅可见文字以文本节点保留）。"""
    for name in ("FILL", "FREE", "INCREMENTAL"):
        assert PROMPT_SURFACES[name].count("降级为普通容器") == 1, name


def test_icon_wording_kept():
    """icon 未知名的如实承诺不得被删（未知名仅渲染兜底占位，repair 只 warning）。"""
    assert "不会降级、不进缺口台账" in PROMPT_SURFACES["icon_prompt"]


def test_icon_unknown_name_no_gap():
    """行为护栏：icon 未知名走 repair 只记 warning，不产生任何缺口行——
    若未来把 icon 未知名并入台账统计，这里先红，届时必须同步改 icon_prompt_section 措辞。"""
    gap_rows: list[dict] = []
    repair_design(
        {"id": "i1", "type": "component", "componentType": "icon", "props": {"name": "自创图标名"}},
        gap_rows=gap_rows,
    )
    assert gap_rows == []
