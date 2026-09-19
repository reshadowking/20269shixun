"""黄金集回归运行器（scripts/run_golden.py）的判据与入口守卫（2026-09-17 首次补测试）。

背景：这个脚本是"生成耗时 / 结构保留率"的取证工具，此前**没有任何测试**——
而它当时有两处会误判：
① 把「模型按指令显式删除的节点」也判成"丢了节点"（与文件头写的 T16 口径矛盾，
   黄金集里的 `edit-remove` 用例真实跑必红）；
② `--only` 拼错导致零匹配时，输出"通过 0/0"并 exit 0（假绿）。
"""
import json
import sys
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent.parent.parent / "scripts"
sys.path.insert(0, str(SCRIPTS))

import run_golden

from app.services.llm import LLMClient

INITIAL = {
    "id": "root",
    "type": "frame",
    "style": {"layout": "column"},
    "children": [
        {"id": "title", "type": "text", "props": {"text": "标题"}},
        {"id": "forgot", "type": "text", "props": {"text": "忘记密码 · 注册账号"}},
    ],
}


def _case(cid: str = "edit-remove") -> dict:
    return {
        "id": cid,
        "mode": "edit",
        "instruction": "删掉「忘记密码 · 注册账号」那一行",
        "expect": {"max_touched": 3, "max_seconds": 45, "max_tokens": 4000},
    }


def _responder(payload: dict):
    def call(system: str, user: str) -> str:
        return json.dumps(payload, ensure_ascii=False) if "设计修改器" in system else ""

    return call


class TestJudge:
    def test_explicit_remove_is_not_reported_as_lost(self):
        """`remove` 显式声明的 id 不该算"丢节点"（T16 口径）。"""
        client = LLMClient(mock_responder=_responder({"ops": [{"op": "remove", "id": "forgot"}]}))
        row = run_golden._run_case(_case(), INITIAL, client)

        assert row["lost_ids"] == [], f"显式删除被判成丢节点：{row['lost_ids']}"
        assert not any("丢了节点" in f for f in run_golden._judge(_case(), row))

    def test_unexpected_loss_is_caught_by_the_gate_and_still_red(self):
        """没说删、却整棵树换掉（旧结构消失）→ 后端结构闸门拦下并回退原树，
        黄金集必须因此判红（走兜底），而不是静默通过——守门不能被上面那条放宽掉。
        """
        client = LLMClient(
            mock_responder=_responder(
                {"id": "root", "type": "frame", "style": {"layout": "column"}, "children": []}
            )
        )
        row = run_golden._run_case(_case("edit-copy"), INITIAL, client)

        # 闸门把画布保住了（回退原树），所以 lost_ids 为空是正确行为；判红靠"走了兜底"这一条
        assert row["lost_ids"] == []
        assert row["fallback"] is True
        judge_case = _case("edit-copy")
        row["mock"] = False  # mock 模式下 _judge 会提前返回；这里模拟真实跑（有 Key）时的判定
        assert any("走了兜底" in f for f in run_golden._judge(judge_case, row))


class TestMainGuard:
    def test_unknown_only_exits_nonzero(self, monkeypatch, capsys):
        """`--only` 拼错（零匹配）不能给出"通过 0/0"的假绿。"""
        monkeypatch.setattr(sys, "argv", ["run_golden.py", "--only", "no-such-case"])
        code = run_golden.main()
        out = capsys.readouterr().out
        assert code == 2, out
        assert "没有匹配的用例" in out

    def test_real_cases_file_still_loads(self):
        """黄金集用例文件结构与判据字段仍然可用（防手工改坏）。"""
        spec = json.loads((SCRIPTS / "golden" / "cases.json").read_text(encoding="utf-8"))
        assert spec["cases"], "黄金集不能为空"
        for case in spec["cases"]:
            for key in ("id", "mode", "instruction", "expect"):
                assert key in case, f"{case.get('id')} 缺字段 {key}"
            for key in ("max_touched", "max_seconds"):
                assert key in case["expect"], f"{case['id']} 的 expect 缺 {key}"
