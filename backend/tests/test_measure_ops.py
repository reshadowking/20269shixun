"""ops A/B 度量脚本（scripts/measure_ops_improvement.py）的结论守卫（2026-09-17 首次补测试）。

该脚本用均值算"out token 降幅 / 耗时降幅"。若某些样本失败或走了兜底（`tokens_out=0`），
均值会被拉低 → **降幅虚高**（新方案恰好失败几条时甚至能报出"降幅 95%"）。
所以含失败样本时必须拒绝给结论。这里用打桩的 `_run` 驱动 `main()`，覆盖两种分支。
"""
import json
import sys
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent.parent.parent / "scripts"
sys.path.insert(0, str(SCRIPTS))

import measure_ops_improvement as mod


def _row(instruction: str, ops_enabled: bool, *, tokens_out: int, latency: float, fallback: bool = False) -> dict:
    return {
        "instruction": instruction,
        "ops_enabled": ops_enabled,
        "latency_s": latency,
        "tokens_out": tokens_out,
        "tokens_in": 100,
        "fallback": fallback,
        "ops_applied": 0 if not ops_enabled else 2,
    }


def _drive(monkeypatch, tmp_path, rows: list[dict], instructions: list[str] | None = None) -> None:
    design = tmp_path / "d.json"
    design.write_text(json.dumps({"id": "root", "type": "frame"}), encoding="utf-8")
    rows_iter = iter(rows)
    # 脚本按 INSTRUCTIONS × (ops 关/开) 逐条跑：这里显式指定指令表，便于精确构造样本顺序
    monkeypatch.setattr(mod, "INSTRUCTIONS", instructions or [rows[0]["instruction"]])
    monkeypatch.setattr(mod, "_run", lambda *_a, **_k: next(rows_iter))
    monkeypatch.setattr(sys, "argv", ["measure_ops_improvement.py", "--design", str(design)])


def test_refuses_conclusion_when_some_samples_failed(monkeypatch, tmp_path, capsys):
    # 指令 1 两臂都成功；指令 2 的新方案失败（tokens_out=0）→ 均值会虚高降幅
    _drive(
        monkeypatch,
        tmp_path,
        [
            _row("把主按钮改成橙色", False, tokens_out=1000, latency=10.0),
            _row("把主按钮改成橙色", True, tokens_out=300, latency=5.0),
            _row("给所有卡片加一层轻阴影", False, tokens_out=1000, latency=10.0),
            _row("给所有卡片加一层轻阴影", True, tokens_out=0, latency=1.0, fallback=True),
        ],
        instructions=["把主按钮改成橙色", "给所有卡片加一层轻阴影"],
    )
    code = mod.main()
    out = capsys.readouterr().out
    assert code == 1, out
    assert "不做结论" in out
    assert "降幅" not in out, f"含失败样本时不该打印降幅：{out}"


def test_all_samples_ok_prints_improvement(monkeypatch, tmp_path, capsys):
    _drive(
        monkeypatch,
        tmp_path,
        [
            _row("把主按钮改成橙色", False, tokens_out=1000, latency=10.0),
            _row("把主按钮改成橙色", True, tokens_out=300, latency=4.0),
        ],
    )
    code = mod.main()
    out = capsys.readouterr().out
    assert code == 0, out
    assert "降幅" in out
    assert "70%" in out  # out token：1000 → 300 = 70% 降幅


def test_all_mock_mode_gives_actionable_hint(monkeypatch, tmp_path, capsys):
    """全部无 token 数据（mock/失败）→ 提示去配 Key，且不给结论。"""
    _drive(
        monkeypatch,
        tmp_path,
        [
            _row("把主按钮改成橙色", False, tokens_out=0, latency=0.0, fallback=True),
            _row("把主按钮改成橙色", True, tokens_out=0, latency=0.0, fallback=True),
        ],
    )
    code = mod.main()
    out = capsys.readouterr().out
    assert code == 1
    assert "mock" in out and "Key" in out
