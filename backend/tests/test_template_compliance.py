"""预置模板的合规率基线（2026-09-17，T19 新口径）。

为什么值得独占一条：模板同时是 ① Mock/兜底时的**产物**、② few-shot 的**骨架**。
它们若违规，会同时污染"合规率"指标和模型学习到的写法。这条守住"模板永远 100% 合规"。

实测基线：8 个模板、36 个颜色字段、0 违规 = 100.0%。
"""
from app.services.compliance import compliance_rate, enforce_compliance
from app.services.templates import TEMPLATES


def test_all_templates_are_fully_compliant():
    report = {}
    for key, tree in TEMPLATES.items():
        _fixed, fixes, total = enforce_compliance(tree)
        report[key] = (compliance_rate(len(fixes), total), total, len(fixes))

    offenders = {k: v for k, v in report.items() if v[2] > 0}
    assert offenders == {}, f"预置模板出现合规违规（新口径）：{offenders}"
    # 顺带守住"模板确实带颜色字段"——否则 total=0 会让上面的断言空过
    assert sum(v[1] for v in report.values()) >= 30, f"模板颜色字段异常偏少：{report}"


def test_enforce_compliance_is_idempotent_on_templates():
    """二次清洗不得改动任何值（模板已经是合规态）——防止"越清越偏"。"""
    for key, tree in TEMPLATES.items():
        once, _f1, _t1 = enforce_compliance(tree)
        twice, fixes2, _t2 = enforce_compliance(once)
        assert twice == once, f"{key} 二次清洗改动了模板"
        assert fixes2 == [], f"{key} 二次清洗仍报违规"
