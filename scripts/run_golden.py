"""T27：真实模型黄金集回归运行器。

用法（需真实模型；本地跑）：
    cd backend && .venv/Scripts/python.exe ../scripts/run_golden.py --out ../docs/T27-golden-report.json
可选：--only edit-color,edit-copy（只跑部分用例）、--model deepseek-chat（覆盖运行时配置）

断言（全部客观可机检）：
1. 结构：编辑类用例的既有节点 id **保留率 100%**（T16 口径；remove 显式声明的除外）；
2. 精度：若本轮走了 ops 路径，则受影响节点数 ≤ `expect.max_touched`；
3. 无失败：所有 ai_calls 的 error_code 为空且 fallback=false；
4. 预算：单条耗时 ≤ max_seconds、fill 阶段 tokens_out ≤ max_tokens（mock 模式跳过 3/4 两项并标注）。
"""
import argparse
import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend"))
GOLDEN_DIR = ROOT / "scripts" / "golden"


def _ids(node: dict, out: list[str] | None = None) -> list[str]:
    out = [] if out is None else out
    if isinstance(node, dict):
        if isinstance(node.get("id"), str):
            out.append(node["id"])
        for child in node.get("children") or []:
            _ids(child, out)
    return out


def _run_case(case: dict, initial: dict, client) -> dict:
    from app.services.generate import generate_design

    design = json.loads(json.dumps(initial))
    started = time.perf_counter()
    if case["mode"] == "edit":
        result = generate_design(case["instruction"], client, current_design=design)
    else:
        result = generate_design(case["instruction"], client)
    elapsed = time.perf_counter() - started
    fill_tokens = sum(c.get("tokens_out", 0) for c in client.calls if c.get("kind") == "fill")
    # T16 口径：既有节点 id 保留率 100%，**remove 显式声明的除外**。
    # 2026-09-17 修：原来直接 `before_ids - after_ids`，于是黄金集里「删掉『忘记密码 · 注册账号』那一行」
    # 这种合法删除会被判成"丢了节点"（与文件头写的口径自相矛盾，真实跑必红）。
    kept = (
        set(_ids(design)) - set(_ids(result.design)) - set(getattr(result, "ops_removed", []))
        if case["mode"] == "edit"
        else set()
    )
    return {
        "id": case["id"],
        "mode": case["mode"],
        "seconds": round(elapsed, 2),
        "tokens_out": fill_tokens,
        "fallback": result.fallback,
        "error": result.error,
        "ops_touched": len(result.ops_applied),
        "lost_ids": sorted(kept),
        "mock": result.mock,
    }


def _judge(case: dict, row: dict) -> list[str]:
    expect = case["expect"]
    failures: list[str] = []
    if row["lost_ids"]:
        failures.append(f"丢了节点：{row['lost_ids'][:3]}")
    if row["ops_touched"] and row["ops_touched"] > expect["max_touched"]:
        failures.append(f"改动节点数 {row['ops_touched']} > {expect['max_touched']}")
    if row["mock"]:
        return failures  # mock 模式无法判定真实 token/耗时与失败码
    if row["fallback"]:
        failures.append(f"走了兜底：{row['error'] or '未知'}")
    if row["seconds"] > expect["max_seconds"]:
        failures.append(f"耗时 {row['seconds']}s > {expect['max_seconds']}s")
    if row["tokens_out"] > expect["max_tokens"]:
        failures.append(f"tokens_out {row['tokens_out']} > {expect['max_tokens']}")
    return failures


def main() -> int:
    parser = argparse.ArgumentParser(description="T27 黄金集回归（需真实模型）")
    parser.add_argument("--out", default=str(ROOT / "docs" / "T27-golden-report.json"))
    parser.add_argument("--only", default="", help="逗号分隔的用例 id 白名单")
    parser.add_argument("--model", default="", help="覆盖运行时模型名（可选）")
    args = parser.parse_args()

    from app.services.llm import LLMClient

    spec = json.loads((GOLDEN_DIR / "cases.json").read_text(encoding="utf-8"))
    initial = json.loads((ROOT / spec["initial_design"]).read_text(encoding="utf-8"))
    wanted = {s for s in args.only.split(",") if s}
    cases = [c for c in spec["cases"] if not wanted or c["id"] in wanted]
    if not cases:
        # 2026-09-17：以前空选择会走到最后输出"通过 0/0"并 exit 0（还会打一句
        # "全部用例处于 mock 模式"）—— 一个 --only 拼错的取证工具会给出**假绿**。
        print(f"[ERROR] 没有匹配的用例（检查 --only 拼写）：{args.only or '(未指定)'}")
        return 2

    rows, failures = [], []
    for case in cases:
        client = LLMClient()
        if args.model:
            client.runtime = {**client.runtime, "llm_mode": "real", "llm_model": args.model}
        row = _run_case(case, initial, client)
        row["failures"] = _judge(case, row)
        rows.append(row)
        failures.extend(f"{row['id']}: {msg}" for msg in row["failures"])
        print(json.dumps(row, ensure_ascii=False))

    passed = len(rows) - len({r["id"] for r in rows if r["failures"]})
    report = {
        "total": len(rows),
        "passed": passed,
        "failed": len(rows) - passed,
        "mock": all(r["mock"] for r in rows),
        "rows": rows,
    }
    Path(args.out).write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n通过 {passed}/{len(rows)}；报告写入 {args.out}")
    if report["mock"]:
        print("[注意] 全部用例处于 mock 模式（未配置 Key）：仅结构断言有效，请配好真实 Key 后重跑。")
    for item in failures:
        print(f"  [FAIL] {item}")
    return 0 if not failures else 1


if __name__ == "__main__":
    raise SystemExit(main())
