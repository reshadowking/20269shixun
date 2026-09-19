"""T52：能力缺口快照定时任务（与工作区自动化"每日 22:00 / 每周五 22:00"配套）。

用法：
  python scripts/gap_snapshot.py --days 1            # 每日：gaps-YYYY-MM-DD.json（滚动保留 30 天）
  python scripts/gap_snapshot.py --days 7 --weekly   # 每周：weekly-<ISO年>-W<周>.md（永久保留）

设计口径：
- 读库经 app.db.SessionLocal（engine 基于 get_settings().pg_url 构建）——.env/环境变量覆盖
  自然生效，**零硬编码主机名**：改端口/切环境本脚本不用动。
- 目录在脚本内 mkdir(parents=True, exist_ok=True)：独立进程运行，没有人会预先建目录。
- 清理按**文件名日期**（gaps-YYYY-MM-DD.json → date.fromisoformat），不是 mtime——mtime 会被
  备份/同步/编辑器 touch，"30 天没碰过的文件"会误删未到期快照；文件名不合规格式的跳过不删。
- **模式分离**：daily 模式只写 gaps-*.json，weekly 模式只写 weekly-*.md——weekly **绝不**写
  daily 文件（历史教训：原实现 weekly 用 7 天数据覆盖当天的 1 天快照 = 数据丢失）。
  周五当天两个都跑（daily 照常 + weekly 聚合），由自动化 prompt 显式保证。
- 日期用**本地 date.today()**，与 cron 的本地时区一致（主机实测 UTC+8；跨时区部署时改
  cron 时区，快照日期自动跟随）。周报文件名用 **ISO 年 + ISO 周**（weekly-2026-W53.md 这种
  跨年组合必须用 isocalendar() 的 iso_year，用 date.year 会产生不存在的"2027-W53"）。
- 周报通道 = weekly-*.md 文件 + stdout Top 5（进自动化运行历史）；不承诺推送。

JSON 结构分两层（envelope / data）：
  envelope = {"kind": "daily", "date": "YYYY-MM-DD", "schema_version": 1}
  data     = report_ai_gaps.py --json v1 的字段集（days/top_n/total/by_gap_type/by_detail/by_model）
schema_version 描述 data 的结构，与 report 的 v1 同号同步升级；kind/date 是 envelope 元数据，
不参与版本兼容。by_model 含 llm_model 原文（配置项，通常无敏感信息）；如需脱敏在配置层做。
"""
import argparse
import json
import sys
from datetime import date, datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))

from report_ai_gaps import GAP_TYPE_LABELS, collect, group  # 同目录模块

SNAPSHOT_DIR = Path(__file__).resolve().parent.parent / "backend" / "logs" / "gap-snapshots"
DAILY_RETENTION_DAYS = 30
JSON_SCHEMA_VERSION = 1  # 描述 data 层结构，与 report_ai_gaps.py --json 的 schema_version 同号同步
REPORT_V1_TOP_N = 10  # report --json v1 的 top_n 默认值——data 层与其逐字段一致


def prune_daily_snapshots(today: date) -> list[str]:
    """按文件名日期滚动清理：删除早于 DAILY_RETENTION_DAYS 的每日快照。返回被删文件名。"""
    cutoff = today - timedelta(days=DAILY_RETENTION_DAYS)
    removed: list[str] = []
    for f in SNAPSHOT_DIR.glob("gaps-*.json"):
        try:
            file_date = date.fromisoformat(f.stem.removeprefix("gaps-"))
        except ValueError:
            continue  # 文件名不符合日期格式（手工放置/损坏）→ 不删
        if file_date < cutoff:
            f.unlink()
            removed.append(f.name)
    return removed


def write_daily_snapshot(rows: list, today: date) -> Path:
    """envelope(kind/date/schema_version) + data(report v1 字段集)。"""
    by_type = group(rows, lambda r: r.gap_type or "")
    by_detail = group(rows, lambda r: r.detail or "(无 detail)")
    by_model = group(rows, lambda r: r.llm_model or "无模型调用")
    payload = {
        "kind": "daily",
        "date": today.isoformat(),
        "schema_version": JSON_SCHEMA_VERSION,
        "data": {
            "days": 1,
            "top_n": REPORT_V1_TOP_N,
            "total": len(rows),
            "by_gap_type": [{"gap_type": k, "count": v} for k, v in sorted(by_type.items(), key=lambda kv: -kv[1])],
            "by_detail": [{"detail": k, "count": v} for k, v in sorted(by_detail.items(), key=lambda kv: (-kv[1], kv[0]))],
            "by_model": [{"llm_model": k, "count": v} for k, v in sorted(by_model.items(), key=lambda kv: -kv[1])],
        },
    }
    path = SNAPSHOT_DIR / f"gaps-{today.isoformat()}.json"
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return path


def weekly_report_path(run_date: date) -> Path:
    """ISO 周命名：weekly-<ISO年>-W<ISO周>.md。必须用 isocalendar() 的 iso_year——
    跨年周（如 2027-01-02 属 2026-W53）用 date.year 会写出不存在的"2027-W53"。"""
    iso_year, iso_week, _ = run_date.isocalendar()
    return SNAPSHOT_DIR / f"weekly-{iso_year}-W{iso_week:02d}.md"


def write_weekly_report(rows: list, run_date: date, days: int) -> Path:
    """人可读周报。文件名 = 覆盖区间末日所在 ISO 周；同周补跑覆盖同文件（幂等）。"""
    by_type = group(rows, lambda r: r.gap_type or "")
    by_detail = group(rows, lambda r: r.detail or "(无 detail)")
    by_model = group(rows, lambda r: r.llm_model or "无模型调用")
    top_detail = sorted(by_detail.items(), key=lambda kv: (-kv[1], kv[0]))[:10]

    lines = [
        (f"# 能力缺口周报（近 {days} 天）"),
        "",
        (f"_生成于 {datetime.now().astimezone().isoformat(timespec='seconds')}（本地时区）· 共 {len(rows)} 条 · "
         f"JSON 快照见同目录 gaps-*.json（schema_version={JSON_SCHEMA_VERSION}）_"),
        "",
        "## 按类型",
        "",
        "| 类型 | 条数 |",
        "| --- | --- |",
    ]
    for name, count in sorted(by_type.items(), key=lambda kv: -kv[1]):
        lines.append(f"| {GAP_TYPE_LABELS.get(name, name or '未分类')} | {count} |")
    lines += ["", "## Top 10 缺口明细（该加什么组件/字段的答案）", "", "| detail | 条数 |", "| --- | --- |"]
    if not top_detail:
        lines.append("| （无记录） | 0 |")
    for name, count in top_detail:
        lines.append(f"| `{name}` | {count} |")
    lines += ["", "## 按模型", "", "| 模型 | 条数 |", "| --- | --- |"]
    for name, count in sorted(by_model.items(), key=lambda kv: -kv[1]):
        lines.append(f"| {name} | {count} |")
    lines += [
        "",
        "> detail 已净化（`<non-ascii>`=模型自创的非标识符内容）；完整原文查 backend/logs/capability_gap_detail.log。",
        "",
    ]
    path = weekly_report_path(run_date)
    path.write_text("\n".join(lines), encoding="utf-8")
    return path


def main() -> int:
    parser = argparse.ArgumentParser(description="能力缺口快照（daily JSON / weekly Markdown）")
    parser.add_argument("--days", type=int, default=1, help="统计窗口天数（daily=1，weekly=7）")
    parser.add_argument("--weekly", action="store_true", help="周报模式：只写 weekly-*.md（**不写** daily 快照）")
    args = parser.parse_args()

    SNAPSHOT_DIR.mkdir(parents=True, exist_ok=True)  # 独立进程：目录必须脚本内自建
    today = datetime.now().astimezone().date()  # 本地日期，与 cron 的本地时区一致
    rows = collect(args.days)

    if args.weekly:
        weekly_path = write_weekly_report(rows, today, args.days)
        print(f"周报：{weekly_path.name}")
        by_detail = group(rows, lambda r: r.detail or "(无 detail)")
        top5 = sorted(by_detail.items(), key=lambda kv: (-kv[1], kv[0]))[:5]
        print("Top 5 缺口：")
        for name, count in top5:
            print(f"  {name}：{count}")
    else:
        daily_path = write_daily_snapshot(rows, today)
        print(f"每日快照：{daily_path.name}（{len(rows)} 条，{args.days} 天窗口）")

    removed = prune_daily_snapshots(today)
    if removed:
        print(f"已清理过期快照 {len(removed)} 个：{', '.join(removed)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
