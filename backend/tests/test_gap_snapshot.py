"""T52 收尾批：gap_snapshot.py 的模式分离 / ISO 周命名 / 文件名日期清理。

核心回归：weekly 模式**不得**写 daily 文件——原实现 weekly 用 7 天数据覆盖当天的
gaps-*.json（当天的独立快照永久丢失 = 数据丢失）。"同日先 daily 后 weekly、daily 内容
字节不变"的断言钉死该修复。
"""
import sys
from datetime import date
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "scripts"))

import gap_snapshot

ROWS = [
    SimpleNamespace(gap_type="degraded", detail="pagination", llm_model="kimi"),
    SimpleNamespace(gap_type="unknown_prop", detail="props.glass", llm_model="kimi"),
    SimpleNamespace(gap_type="unknown_prop", detail="props.glass", llm_model="kimi"),
]


def test_weekly_does_not_touch_daily(tmp_path, monkeypatch):
    """同一天先 daily 再 weekly：daily 文件必须字节不变（weekly 只写自己的 md）。"""
    monkeypatch.setattr(gap_snapshot, "SNAPSHOT_DIR", tmp_path)
    today = date(2026, 9, 25)

    daily = gap_snapshot.write_daily_snapshot(ROWS, today)
    before = daily.read_bytes()
    weekly = gap_snapshot.write_weekly_report(ROWS, today, 7)

    assert daily.read_bytes() == before, "weekly 覆盖 daily = 数据丢失（原实现缺陷）"
    assert weekly.exists() and weekly.suffix == ".md"
    assert list(tmp_path.glob("gaps-*.json")) == [daily]


def test_weekly_filename_uses_iso_year_across_year_boundary(tmp_path, monkeypatch):
    """跨年周用关系断言（不硬编码 W53 是否存在）：三个同 ISO 周的日期映射同一文件，
    下周一映射到不同文件；文件名年份必须取 isocalendar() 的 iso_year。"""
    monkeypatch.setattr(gap_snapshot, "SNAPSHOT_DIR", tmp_path)
    # 2026-12-31（周四）/ 2027-01-01（周五）/ 2027-01-02（周六）属同一个 ISO 周；
    # 2027-01-04（周一）进入下一个 ISO 周。
    same_week = [date(2026, 12, 31), date(2027, 1, 1), date(2027, 1, 2)]
    names = set()
    for d in same_week:
        path = gap_snapshot.write_weekly_report(ROWS, d, 7)
        names.add(path.name)
        # 文件名中的年份必须等于 ISO 年（2026-12-31 的 date.year=2026 恰好巧合一致；
        # 2027-01-01 的 date.year=2027 但 ISO 年=2026——用关系断言抓这个陷阱）
        iso_year, iso_week, _ = d.isocalendar()
        assert path.name == f"weekly-{iso_year}-W{iso_week:02d}.md"
    assert len(names) == 1, "同一 ISO 周的三天必须落到同一个文件（幂等）"

    next_week = gap_snapshot.write_weekly_report(ROWS, date(2027, 1, 4), 7)
    assert next_week.name not in names, "下一个 ISO 周必须是新文件"


def test_prune_by_filename_date_skips_malformed(tmp_path, monkeypatch):
    """清理只认文件名里的日期：过期删、未到期留、格式不符跳过（mtime 不参与判定）。"""
    monkeypatch.setattr(gap_snapshot, "SNAPSHOT_DIR", tmp_path)
    today = date(2026, 9, 25)
    old = tmp_path / "gaps-2026-08-01.json"
    fresh = tmp_path / f"gaps-{today.isoformat()}.json"
    malformed = tmp_path / "gaps-not-a-date.json"
    for f in (old, fresh, malformed):
        f.write_text("{}", encoding="utf-8")

    removed = gap_snapshot.prune_daily_snapshots(today)

    assert removed == ["gaps-2026-08-01.json"]
    assert fresh.exists() and malformed.exists()
