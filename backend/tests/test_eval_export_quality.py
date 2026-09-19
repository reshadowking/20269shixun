"""还原度评测脚本单测（P0-3）：提取逻辑、加权计算、一键运行。"""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "scripts"))

from eval_export_quality import (
    component_rate,
    evaluate,
    extract_from_code,
    extract_from_design,
    python_generate_code,
    run,
    structure_rate,
    text_rate,
)

SAMPLE = {
    "id": "root",
    "type": "frame",
    "style": {"layout": "column"},
    "children": [
        {"id": "t", "type": "text", "props": {"text": "商品标题"}},
        {"id": "b", "type": "component", "componentType": "button", "props": {"text": "立即购买"}},
        {"id": "n", "type": "component", "componentType": "navbar", "props": {"title": "商城", "links": [{"label": "首页", "href": "#"}]}},
        {"id": "c", "type": "component", "componentType": "chart", "props": {"title": "趋势", "data": [{"day": "周一", "value": 10}]}},
    ],
}


class TestExtract:
    def test_design_extract(self):
        d = extract_from_design(SAMPLE)
        assert d["components"] == {"button": 1, "navbar": 1, "chart": 1}
        assert "商品标题" in d["texts"]
        assert "立即购买" in d["texts"]
        assert "首页" in d["texts"]
        assert d["max_depth"] >= 1

    def test_code_extract_tags_and_texts(self):
        code = '<div style=""><button>立即购买</button><nav><strong>商城</strong><a href="#">首页</a></nav><div>趋势</div></div>'
        c = extract_from_code(code)
        assert c["tags"]["button"] == 1
        assert c["tags"]["nav"] == 1
        assert "立即购买" in c["texts"]
        assert "首页" in c["texts"]

    def test_code_extract_unescapes_html(self):
        c = extract_from_code("<div>&lt;script&gt;</div>")
        assert "<script>" in c["texts"]

    def test_code_extract_includes_visible_attribute_text(self):
        """属性里的用户可见文本也要算（2026-09-17 修）。

        实测：login 样稿的两条 placeholder 在产物 `<input placeholder="…">` 里，
        旧实现只看标签间文本 → 文本一致率 0.750（实为 1.000），聚合还原度少 3.3pp。
        """
        c = extract_from_code('<input placeholder="请输入密码" /><img alt="配图" title="提示" />')
        assert "请输入密码" in c["texts"]
        assert "配图" in c["texts"]
        assert "提示" in c["texts"]

    def test_placeholder_text_counts_as_matched(self):
        design_texts = ["请输入邮箱或手机号", "请输入密码"]
        code = python_generate_code(
            {
                "id": "root",
                "type": "frame",
                "style": {"layout": "column"},
                "children": [
                    {"id": "i1", "type": "component", "componentType": "input", "props": {"placeholder": "请输入邮箱或手机号"}},
                    {"id": "i2", "type": "component", "componentType": "input", "props": {"placeholder": "请输入密码"}},
                ],
            }
        )
        assert text_rate(design_texts, extract_from_code(code)["texts"]) == 1.0


class TestRates:
    def test_component_rate_perfect(self):
        assert component_rate({"button": 2, "navbar": 1}, {"button": 2, "nav": 1}) == 1.0

    def test_component_rate_partial(self):
        # 设计 3 个按钮，代码只有 2 个 → 2/3
        assert component_rate({"button": 3}, {"button": 2}) == 2 / 3

    def test_text_rate(self):
        assert text_rate(["a", "b", "c"], ["a", "b"]) == 2 / 3
        assert text_rate([], ["x"]) == 1.0

    def test_structure_rate(self):
        assert structure_rate({"max_depth": 3, "container_count": 4}, {"max_depth": 3, "container_count": 4}) == 1.0
        assert structure_rate({"max_depth": 2, "container_count": 2}, {"max_depth": 4, "container_count": 4}) == 0.5

    def test_overall_weighted(self):
        r = evaluate(SAMPLE, python_generate_code(SAMPLE))
        expected = 0.4 * r["component_rate"] + 0.4 * r["text_rate"] + 0.2 * r["structure_rate"]
        assert abs(r["overall"] - round(expected, 4)) < 1e-9
        # 自产自比应接近 1.0（组件映射一致 + 文本一致）
        assert r["overall"] >= 0.85  # chart 内部结构差异属真实导出差距

    def test_imperfect_code_scores_below(self):
        """导出代码缺失一个组件时还原度下降。"""
        code = "\n".join(l for l in python_generate_code(SAMPLE).splitlines() if "<button" not in l)
        r = evaluate(SAMPLE, code)
        assert r["component_rate"] < 1.0
        assert r["overall"] < 1.0


class TestRun:
    def test_run_samples(self, tmp_path):
        out = tmp_path / "report.json"
        designs_dir = Path(__file__).resolve().parent.parent.parent / "scripts" / "designs"
        report = run(designs_dir, out)
        assert set(report["reports"].keys()) == {"ecommerce", "dashboard", "login"}
        assert report["average"] > 0
        assert out.exists()
        data = json.loads(out.read_text(encoding="utf-8"))
        assert data["average"] == report["average"]
