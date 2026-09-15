"""T21：AI 调用记账聚合报告（零外部依赖）。

用法：python scripts/report_ai_calls.py --days 7 [--json]
输出：按模型 / 提示词版本 / 阶段分组的调用数、成功率、P50/P95 时延、token 合计、兜底次数。
"""
import argparse
import json
import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))


def _pct(values: list[int], q: float) -> int:
    if not values:
        return 0
    ordered = sorted(values)
    return int(ordered[min(len(ordered) - 1, max(0, round(q * (len(ordered) - 1))))])


def collect(days: int) -> dict:
    from app.db import SessionLocal
    from app.models import AiCall
    from sqlalchemy import select

    since = datetime.now(UTC) - timedelta(days=days)
    db = SessionLocal()
    try:
        rows = list(db.execute(select(AiCall).where(AiCall.created_at >= since)).scalars())
    finally:
        db.close()

    def group(key: str) -> list[dict]:
        buckets: dict[str, list] = {}
        for row in rows:
            buckets.setdefault(getattr(row, key) or "(空)", []).append(row)
        return [
            {
                key: name,
                "calls": len(items),
                "ok_rate": round(sum(1 for r in items if r.ok) / len(items) * 100, 1),
                "p50_ms": _pct([r.latency_ms for r in items], 0.5),
                "p95_ms": _pct([r.latency_ms for r in items], 0.95),
                "tokens_in": sum(r.tokens_in for r in items),
                "tokens_out": sum(r.tokens_out for r in items),
                "fallback": sum(1 for r in items if r.fallback),
            }
            for name, items in sorted(buckets.items())
        ]

    return {
        "days": days,
        "since": since.isoformat(),
        "total_calls": len(rows),
        "by_model": group("model"),
        "by_prompt_version": group("prompt_version"),
        "by_kind": group("kind"),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="AI 调用记账聚合报告（T21）")
    parser.add_argument("--days", type=int, default=7)
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()
    report = collect(args.days)
    if args.json:
        print(json.dumps(report, ensure_ascii=False, indent=2))
        return 0
    print(f"最近 {report['days']} 天共 {report['total_calls']} 次调用")
    for section, key in (("按模型", "model"), ("按提示词版本", "prompt_version"), ("按阶段", "kind")):
        print(f"\n== {section} ==")
        for row in report[{"model": "by_model", "prompt_version": "by_prompt_version", "kind": "by_kind"}[key]]:
            print(
                f"  {row[key]:<18} calls={row['calls']:<5} ok={row['ok_rate']}% "
                f"p50={row['p50_ms']}ms p95={row['p95_ms']}ms tok_in={row['tokens_in']} "
                f"tok_out={row['tokens_out']} fallback={row['fallback']}"
            )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
