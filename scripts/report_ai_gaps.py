"""T52：能力缺口台账聚合报告（零外部依赖）。

用法：python scripts/report_ai_gaps.py --days 7 [--top 10] [--json]
输出：按 gap_type / detail / 模型 分组——
- by_detail 的 Top N 就是"该加什么组件/补哪个字段"的直接答案：
  degraded 的 detail=pagination → 考虑建 pagination 组件；
  unknown_prop 的 detail=props.glass → 考虑给组件补玻璃效果字段。
- by_model 用于归因（哪个模型最爱产出链路表达不了的东西）。

detail/node_id 入库前经 ai_ledger._sanitize_detail 净化（非标识符字符 → <non-ascii>），
所以这里的 detail 永远是可聚合的安全标识；完整原文只在本地 generate.log。

`llm_model` 为空的记录单列"无模型调用"组：mock / 熔断开路 / 填充前失败，不混进模型统计。

输出 JSON 结构（schema_version=1，改字段名/结构时先升版本并在本 docstring 对照写 diff）：
{
  "schema_version": 1,
  "days": 7,
  "top_n": 10,
  "total": 59,
  "by_gap_type": [{"gap_type": "degraded", "count": 42}, ...],
  "by_detail":   [{"detail": "pagination", "count": 30}, ...],        // 按 total 降序，截前 top_n
  "by_model":    [{"llm_model": "kimi-k2.7-code", "count": 30}, ...]
}

快照脚本 gap_snapshot.py 的 daily JSON：envelope(kind/date/schema_version) + data——**data 与本
--json v1 字段集一致**，schema_version 同号同步升级（详见 gap_snapshot.py 模块 docstring）。
"""
import argparse
import json
import re
import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))

GAP_TYPE_LABELS = {
    "degraded": "能力降级（组件/类型缺失）",
    "ops_rejected": "ops 落地被拒",
    "unknown_prop": "契约外字段",
    "": "未分类",
}

_INSERT_SIZE_RE = re.compile(r"^ops:insert\.node(\d+)\.depth(\d+)$")


def _parse_insert_size(detail: str) -> tuple[int, int] | None:
    """'ops:insert.node34.depth4' → (34, 4)；非 insert 尺寸格式返回 None。

    P2（ops 上限调优）的数据入口：台账 detail 由 generate_design 逐被拒 op 写入。"""
    m = _INSERT_SIZE_RE.match(detail or "")
    return (int(m.group(1)), int(m.group(2))) if m else None


def collect(days: int) -> list:
    from app.db import SessionLocal
    from app.models import AiCapabilityGap

    since = datetime.now(UTC) - timedelta(days=days)
    db = SessionLocal()
    try:
        return list(db.query(AiCapabilityGap).filter(AiCapabilityGap.created_at >= since).all())
    finally:
        db.close()


def group(rows: list, key) -> dict:
    out: dict[str, int] = {}
    for row in rows:
        out[key(row)] = out.get(key(row), 0) + 1
    return out


def main() -> None:
    parser = argparse.ArgumentParser(description="AI 能力缺口聚合报告")
    parser.add_argument("--days", type=int, default=7)
    parser.add_argument("--top", type=int, default=10, help="by_detail 只展示前 N 项")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()

    rows = collect(args.days)
    by_type = group(rows, lambda r: r.gap_type or "")
    by_detail = group(rows, lambda r: r.detail or "(无 detail)")
    by_model = group(rows, lambda r: r.llm_model or "无模型调用")

    # detail Top N：按出现次数降序；同次数按名字稳定排序（多次运行输出不漂移）
    top_detail = sorted(by_detail.items(), key=lambda kv: (-kv[1], kv[0]))[: args.top]

    if args.json:
        print(
            json.dumps(
                {
                    "schema_version": 1,
                    "days": args.days,
                    "top_n": args.top,
                    "total": len(rows),
                    "by_gap_type": [{"gap_type": k, "count": v} for k, v in sorted(by_type.items(), key=lambda kv: -kv[1])],
                    "by_detail": [{"detail": k, "count": v} for k, v in top_detail],
                    "by_model": [{"llm_model": k, "count": v} for k, v in sorted(by_model.items(), key=lambda kv: -kv[1])],
                },
                ensure_ascii=False,
                indent=2,
            )
        )
        return

    print(f"近 {args.days} 天能力缺口 {len(rows)} 条")
    print("\n== 按类型 ==")
    for name, count in sorted(by_type.items(), key=lambda kv: -kv[1]):
        print(f"  {GAP_TYPE_LABELS.get(name, name or '未分类')}：{count}")
    insert_nodes = []
    for r in rows:
        if r.gap_type == "ops_rejected":
            parsed = _parse_insert_size(r.detail)
            if parsed:
                insert_nodes.append(parsed[0])
    insert_nodes.sort()
    if insert_nodes:
        print(f"\n== insert 尺寸分布（{len(insert_nodes)} 条，P2 上限调优数据）==")
        print(f"  节点数：min={insert_nodes[0]} 中位={insert_nodes[len(insert_nodes) // 2]} max={insert_nodes[-1]}")
        if len(insert_nodes) < 10:
            print(f"  明细：{insert_nodes}（样本 <10，暂不给分布结论）")
    print(f"\n== Top {args.top} 缺口明细（该加什么组件/字段的答案）==")
    if not top_detail:
        print("  （无记录）")
    for name, count in top_detail:
        print(f"  {name}：{count}")
    print("\n== 按模型 ==")
    for name, count in sorted(by_model.items(), key=lambda kv: -kv[1]):
        print(f"  {name}：{count} 条")
    print("\ndetail 已净化（<non-ascii>=模型自创的非标识符内容）；完整原文查本地 generate.log。")


if __name__ == "__main__":
    main()
