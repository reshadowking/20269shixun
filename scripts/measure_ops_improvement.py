"""T23 对照脚本：同一批指令跑「整树输出（旧）」vs「ops 输出（新）」，对比 token 与耗时。

用法（需要真实模型 Key，本地跑）：
    cd backend && .venv/Scripts/python.exe ../scripts/measure_ops_improvement.py --design 一个设计稿.json

做法：分别以 `PROMPT_OPS_ENABLED=0/1` 启动（脚本内部改配置）跑同一批指令，
读取 `client.calls` 里 fill 调用的 tokens_out 与耗时，输出对照表与降幅。
注意：两次运行使用同一棵 current_design，且同一模型/温度，保证可比。
"""
import argparse
import json
import statistics
import sys
import time
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent / "backend"
sys.path.insert(0, str(BACKEND))

INSTRUCTIONS = [
    "把主按钮改成橙色",
    "把标题字号调大到 28",
    "给所有卡片加一层轻阴影",
]


def _run(design: dict, instruction: str, ops_enabled: bool) -> dict:
    from app.config import get_settings
    from app.services.generate import generate_design
    from app.services.llm import LLMClient

    settings = get_settings()
    settings.prompt_ops_enabled = ops_enabled
    client = LLMClient()
    started = time.perf_counter()
    result = generate_design(instruction, client, current_design=json.loads(json.dumps(design)))
    elapsed = time.perf_counter() - started
    fill = [c for c in client.calls if c.get("kind") == "fill"]
    return {
        "instruction": instruction,
        "ops_enabled": ops_enabled,
        "latency_s": round(elapsed, 2),
        "tokens_out": sum(c.get("tokens_out", 0) for c in fill),
        "tokens_in": sum(c.get("tokens_in", 0) for c in fill),
        "fallback": result.fallback,
        "ops_applied": len(result.ops_applied),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="T23 ops 化前后对照（需真实模型）")
    parser.add_argument("--design", required=True, help="当前设计树 JSON 文件（导出/保存得到）")
    parser.add_argument(
        "--allow-real",
        action="store_true",
        help="允许真跑（会产生真实 API 费用）；不加则遇到 real 模式直接拒绝",
    )
    args = parser.parse_args()

    # 2026-09-17：与 run_golden.py 同一道硬护栏。
    # 本脚本自己 `LLMClient()` 读 backend/.env（real + 真实 Key），**与后端进程的环境变量无关** ——
    # 在另一个 shell 里设过 LLM_MODE=mock 并不能拦住它（run_golden 那边正是这么误烧了 9 次调用）。
    from app.services.llm import LLMClient

    probe = LLMClient()
    mode = "mock（不打外网）" if probe.is_mock else "REAL（会真的调用付费 API，产生费用）"
    print(f"[模式] {mode} | 端点 {probe.cfg('llm_base_url')} | 模型 {probe.cfg('llm_model')}")
    if not probe.is_mock and not args.allow_real:
        print("[拒绝] 当前是 REAL 模式：本脚本要跑 3 条指令 × 2 种配置 = 6 次真实调用。")
        print("       确实要跑 → 加 `--allow-real`；只想离线看结构 → 在**同一个命令**里带上 LLM_MODE=mock。")
        return 2

    design = json.loads(Path(args.design).read_text(encoding="utf-8"))

    rows = []
    for instruction in INSTRUCTIONS:
        for ops_enabled in (False, True):
            row = _run(design, instruction, ops_enabled)
            rows.append(row)
            print(json.dumps(row, ensure_ascii=False))

    base = [r for r in rows if not r["ops_enabled"]]
    new = [r for r in rows if r["ops_enabled"]]
    if not any(r["tokens_out"] for r in rows):
        print(
            "\n[注意] 没有拿到任何 token 数据——当前后端处于 mock 模式（未配置 Key）或调用全部失败。\n"
            "请在「API 配置」页填入真实 Key（或 .env 里 LLM_MODE=real + LLM_API_KEY）后重跑本脚本。"
        )
        return 1
    # 2026-09-17：失败/兜底样本（tokens_out=0）会把均值拉低，从而**虚高**降幅
    # （例如新方案恰好失败几条，"降幅 95%" 是假的）。含失败样本时不给结论。
    failed = [r for r in rows if r["fallback"] or not r["tokens_out"]]
    if failed:
        print("\n[注意] 以下样本失败或没有 token 数据，均值不可用于结论（ops 对照要求每条都真实完成）：")
        for r in failed:
            print(
                f"  - 「{r['instruction']}」（ops={r['ops_enabled']}）"
                f"latency={r['latency_s']}s fallback={r['fallback']} tokens_out={r['tokens_out']}"
            )
        print("请检查 Key / 配额 / 网络后重跑；含失败样本时本脚本**不做结论**。")
        return 1
    out_base, out_new = statistics.mean(r["tokens_out"] for r in base), statistics.mean(r["tokens_out"] for r in new)
    lat_base, lat_new = statistics.mean(r["latency_s"] for r in base), statistics.mean(r["latency_s"] for r in new)
    print("\n== 对照（3 条指令均值）==")
    print(f"out token：旧 {out_base:.0f} → 新 {out_new:.0f}（降幅 {(1 - out_new / out_base) * 100:.1f}%）")
    print(f"端到端耗时：旧 {lat_base:.2f}s → 新 {lat_new:.2f}s（降幅 {(1 - lat_new / lat_base) * 100:.1f}%）")
    print("判定：out token 降幅 ≥70% 且耗时降幅 ≥50% 视为达标（T23 卡口径）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
