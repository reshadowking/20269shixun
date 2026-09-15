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
    args = parser.parse_args()
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
    out_base, out_new = statistics.mean(r["tokens_out"] for r in base), statistics.mean(r["tokens_out"] for r in new)
    lat_base, lat_new = statistics.mean(r["latency_s"] for r in base), statistics.mean(r["latency_s"] for r in new)
    print("\n== 对照（3 条指令均值）==")
    print(f"out token：旧 {out_base:.0f} → 新 {out_new:.0f}（降幅 {(1 - out_new / out_base) * 100:.1f}%）")
    print(f"端到端耗时：旧 {lat_base:.2f}s → 新 {lat_new:.2f}s（降幅 {(1 - lat_new / lat_base) * 100:.1f}%）")
    print("判定：out token 降幅 ≥70% 且耗时降幅 ≥50% 视为达标（T23 卡口径）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
