"""T51：AI 效果反馈聚合报告（零外部依赖）。

用法：python scripts/report_ai_feedback.py --days 30 [--json]
输出：按 类别 / 模型 / 提示词版本 分组的 👍/👎 数量与差评 Top——回答"哪类问题最多"，
这是"反馈闭环"里最关键的一张表：没有它，链路优化只能靠猜。

`llm_model` 为空的记录单列"无模型调用"组：那些是熔断开路 / mock / 填充前失败的反馈，
**不能**混进某个模型的统计里。
"""
import argparse
import json
import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))

CATEGORY_LABELS = {
    "structure": "结构不对",
    "style": "样式不对",
    "aesthetic": "审美不对",
    "not_applied": "改了没生效",
    "worse": "越改越差",
    "": "未分类",
}


def collect(days: int) -> list:
    from app.db import SessionLocal
    from app.models import AiFeedback

    since = datetime.now(UTC) - timedelta(days=days)
    db = SessionLocal()
    try:
        return list(db.query(AiFeedback).filter(AiFeedback.created_at >= since).all())
    finally:
        db.close()


def group(rows: list, key) -> dict:
    out: dict[str, dict] = {}
    for row in rows:
        name = key(row)
        bucket = out.setdefault(name, {"total": 0, "up": 0, "down": 0})
        bucket["total"] += 1
        if row.rating > 0:
            bucket["up"] += 1
        else:
            bucket["down"] += 1
    return out


def main() -> None:
    parser = argparse.ArgumentParser(description="AI 效果反馈聚合报告")
    parser.add_argument("--days", type=int, default=30)
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()

    rows = collect(args.days)
    by_category = group(rows, lambda r: CATEGORY_LABELS.get(r.category, r.category or "未分类"))
    by_model = group(rows, lambda r: r.llm_model or "无模型调用")
    by_version = group(rows, lambda r: r.prompt_version or "无模型调用")

    if args.json:
        print(json.dumps({"days": args.days, "total": len(rows), "by_category": by_category,
                          "by_model": by_model, "by_prompt_version": by_version},
                         ensure_ascii=False, indent=2))
        return

    print(f"近 {args.days} 天反馈 {len(rows)} 条")
    print("\n== 按类别（哪类问题最多）==")
    for name, bucket in sorted(by_category.items(), key=lambda kv: -kv[1]["down"]):
        print(f"  {name}：差评 {bucket['down']} / 共 {bucket['total']}")
    print("\n== 按模型 ==")
    for name, bucket in sorted(by_model.items(), key=lambda kv: -kv[1]["total"]):
        print(f"  {name}：{bucket['total']} 条（差评 {bucket['down']}）")
    print("\n== 按提示词版本 ==")
    for name, bucket in sorted(by_version.items(), key=lambda kv: -kv[1]["total"]):
        print(f"  {name}：{bucket['total']} 条（差评 {bucket['down']}）")
    print("\n无模型调用的反馈单列一组，不混进模型统计。")


if __name__ == "__main__":
    main()
