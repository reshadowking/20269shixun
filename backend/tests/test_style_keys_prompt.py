"""T49（C6）：可渲染 style 键的提示词注入。

三方一致（本轮新增的第三腿）：`shared/style-keys.json` ↔ 前端 `styleToCss`（由
`frontend/src/design/styleKeys.test.ts` 断言 import 到的就是该文件）↔ 本模块注入的文本。
"""
import json
from pathlib import Path

from app.services.generate import incremental_system
from app.services.style_keys import SPEC, renderable_keys, style_keys_text

ROOT = Path(__file__).resolve().parent.parent.parent
SHARED = ROOT / "shared" / "style-keys.json"


class TestStyleKeysText:
    def test_与_shared_JSON_同源(self):
        data = json.loads(SHARED.read_text(encoding="utf-8"))
        assert renderable_keys() == list(data["renderable"])
        assert SPEC["aliases"] == data["aliases"]

    def test_每个可渲染键都出现在文本里(self):
        text = style_keys_text()
        missing = [key for key in renderable_keys() if key not in text]
        assert not missing, f"这些可渲染键没进提示词：{missing}"

    def test_带中文名与别名提示(self):
        text = style_keys_text()
        assert "阴影（CSS 字符串）" in text  # labels 被用上，便于模型理解语义
        assert "boxShadow" in text and "自动归一" in text
        assert "渲染不出来" in text  # 未登记键的后果说清楚

    def test_无模块级缓存_改数据后文本立即跟随(self, monkeypatch):
        """防漂移的前提：文本每次现算。扩键后不必重启、也不必改本模块。"""
        monkeypatch.setitem(SPEC, "renderable", [*renderable_keys(), "brandNewKey"])
        monkeypatch.setitem(SPEC, "labels", {**SPEC["labels"], "brandNewKey": "新键"})
        assert "brandNewKey（新键）" in style_keys_text()


class TestInjection:
    def test_增量提示词里真的带上了这一段(self):
        prompt = incremental_system(locked=False, assets=None)
        assert "## 可用的样式键（style 的键名，只能用这些）" in prompt
        missing = [key for key in renderable_keys() if key not in prompt]
        assert not missing, f"增量提示词缺这些键：{missing}"

    def test_锁定与非锁定都会注入_样式键与锁无关(self):
        assert "## 可用的样式键" in incremental_system(locked=True, assets=None)
