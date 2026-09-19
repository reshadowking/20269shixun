"""T4 前置：mock 模式增量修改产出确定性改写树（而非 fallback 原树）。

背景：mock 模式 chat_text 返回空串 → chat_json 得 None → 增量修改必走
fallback=True（返回原树）→ 前端显示"修改失败"，「AI 修改 → 落地闸门」链路
在无 Key 环境不可达（E2E/CI 测不了）。修复后 mock 编辑按关键词规则产出
确定性改写树，仍走 repair → validate → compliance 同一条流水线。
"""
import copy

from app.design.validator import validate_design
from app.services.beautify import EFFECT_VALUES, preset_value
from app.services.compliance import enforce_compliance
from app.services.generate import MOCK_DEFAULT_SHADOW_LABEL, MOCK_EDIT_TEXT, generate_design
from app.services.templates import TEMPLATES


def base_tree() -> dict:
    """合规的基准树（模板先过一遍合规，规避合规修正对 diff 断言的干扰）。"""
    design, _, _ = enforce_compliance(copy.deepcopy(TEMPLATES["ecommerce"]))
    return design


def _walk_nodes(tree: dict):
    yield tree
    for child in tree.get("children") or []:
        yield from _walk_nodes(child)


def _ids(tree: dict) -> list[str]:
    return [str(n.get("id")) for n in _walk_nodes(tree)]


def test_mock增量修改_fallback_false_且产出树不同():
    original = base_tree()
    result = generate_design("给卡片加个阴影", current_design=copy.deepcopy(original))
    assert result.fallback is False
    assert result.design != original  # 不是 fallback 回原树
    assert result.error == ""


def test_阴影prompt只改shadow_其余字段全不动():
    original = base_tree()
    result = generate_design("给卡片加个阴影", current_design=copy.deepcopy(original))
    # 结构不变
    assert _ids(result.design) == _ids(original)
    before = {n["id"]: n for n in _walk_nodes(original)}
    after = {n["id"]: n for n in _walk_nodes(result.design)}
    changed_style_keys: set[str] = set()
    for node_id, b in before.items():
        a = after[node_id]
        # 文案/结构属性不变
        assert a.get("props") == b.get("props"), node_id
        assert a.get("type") == b.get("type"), node_id
        assert a.get("componentType") == b.get("componentType"), node_id
        assert a.get("x") == b.get("x") and a.get("y") == b.get("y"), node_id
        # style 只允许 shadow 变化
        sb, sa = b.get("style") or {}, a.get("style") or {}
        for key in set(sb) | set(sa):
            if sb.get(key) != sa.get(key):
                changed_style_keys.add(key)
    assert changed_style_keys == {"shadow"}


def test_改文案prompt只改第一个text节点的props():
    original = base_tree()
    result = generate_design("把主标题改成 新的标题文案", current_design=copy.deepcopy(original))
    assert result.fallback is False
    before = {n["id"]: n for n in _walk_nodes(original)}
    after = {n["id"]: n for n in _walk_nodes(result.design)}
    assert _ids(result.design) == _ids(original)
    text_changed = []
    for node_id, b in before.items():
        a = after[node_id]
        if b.get("props") != a.get("props"):
            assert b.get("type") == "text", f"只允许改 text 节点：{node_id}"
            text_changed.append(node_id)
        assert a.get("style") == b.get("style"), node_id  # style 不动
    assert len(text_changed) == 1
    assert after[text_changed[0]]["props"]["text"] == MOCK_EDIT_TEXT
    assert MOCK_EDIT_TEXT != before[text_changed[0]]["props"]["text"]


def test_确定性_同prompt两次调用产出一致():
    r1 = generate_design("给卡片加个阴影", current_design=base_tree())
    r2 = generate_design("给卡片加个阴影", current_design=base_tree())
    assert r1.design == r2.design


def test_产出树过Schema校验():
    result = generate_design("给卡片加个阴影", current_design=base_tree())
    validate_design(result.design)  # 不抛即通过


def test_效果值命中单一来源预置集合_防写死():
    original = base_tree()
    result = generate_design("给卡片加个阴影", current_design=copy.deepcopy(original))
    before = {n["id"]: n for n in _walk_nodes(original)}
    applied = []
    for n in _walk_nodes(result.design):
        b = before[n["id"]]
        sv, bv = (n.get("style") or {}).get("shadow"), (b.get("style") or {}).get("shadow")
        if sv is not None and sv != bv:  # 只看 mock 施加的值，不算模板原有的
            applied.append(sv)
    assert applied, "应至少有一个节点被施加阴影"
    for value in applied:
        assert value in EFFECT_VALUES["shadow"]
    assert applied[0] == preset_value("shadow", "轻")  # 与 beautify-effects.json「轻」一致


def test_兜底默认效果_可见且不等于组件内置默认阴影():
    """2026-09-18：兜底默认从前用的「极轻」与 card 内置默认阴影**逐字相同**
    （前端 `styleTokens.ts` 的 CARD_SHADOW 就取 shadow 预置第 0 档）→ 演示模式下
    "点一次美化 → 已应用修改 ✓ → 画面完全没变"，用户会合理怀疑功能没生效。

    这里锁住两件事：兜底分支确实施加了效果，且**不等于**组件内置默认值。
    """
    original = base_tree()
    # 这句不含任何效果/文案关键词 → 走兜底分支
    result = generate_design("随便看看有没有问题", current_design=copy.deepcopy(original))
    before = {n["id"]: n for n in _walk_nodes(original)}
    applied = [
        (n.get("style") or {}).get("shadow")
        for n in _walk_nodes(result.design)
        if (n.get("style") or {}).get("shadow") is not None
        and (n.get("style") or {}).get("shadow") != (before[n["id"]].get("style") or {}).get("shadow")
    ]
    assert applied, "兜底分支应至少施加一个阴影"
    assert applied[0] == preset_value("shadow", MOCK_DEFAULT_SHADOW_LABEL), "兜底值必须取自预置单一来源"
    assert applied[0] != preset_value("shadow", "极轻"), "兜底默认不能等于组件内置默认阴影（等于没改）"


def test_效果关键词映射齐全_取值均命中预置():
    cases = [
        ("给渐变背景换个感觉", "backgroundImage"),
        ("卡片圆角大一点", "radius"),
        ("加个入场动画", "animation"),
    ]
    for prompt, key in cases:
        original = base_tree()
        result = generate_design(prompt, current_design=copy.deepcopy(original))
        assert result.fallback is False, prompt
        before = {n["id"]: n for n in _walk_nodes(original)}
        applied = []
        for n in _walk_nodes(result.design):
            b = before[n["id"]]
            v, bv = (n.get("style") or {}).get(key), (b.get("style") or {}).get(key)
            if v is not None and v != bv:  # 只收集 mock 施加的（模板原有的 key 不算）
                applied.append(v)
        assert applied, prompt
        for value in applied:
            assert value in EFFECT_VALUES[key], (prompt, value)


def test_mock标记仍生效():
    result = generate_design("给卡片加个阴影", current_design=base_tree())
    assert result.mock is True  # 前端据此外观标注"演示产物"，不与模型产物混淆
