"""T4 批2：效果词典运行时注入（vocabulary_text）。

防漂移是本批核心：词典必须由 shared/beautify-effects.json **生成**而非手写——
- 「临时改 WHITELIST → 词典跟着变」证明是生成（抄写的词典不会变）；
- 「词典文本中的取值集合 == EFFECT_VALUES（逐组比对）」锁死覆盖面，防手抄漏项/多项。
"""

from app.services.beautify import (
    EFFECT_CHANGES_SIZE,
    EFFECT_KEYS,
    EFFECT_VALUES,
    WHITELIST,
    vocabulary_text,
)


def _parse_groups(text: str) -> dict[str, set]:
    """把词典文本解析回 {key: 取值集合}，供与 EFFECT_VALUES 逐组比对。

    依赖 vocabulary_text 的行格式：`- {key}（{label}）…：{label}={value}；…`。
    预置值本身不含「＝/=」「：」「；」字符；若未来格式变化导致解析失败，
    测试会红——这正是期望行为（格式变了必须连测试一起改，不能静默漂移）。
    """
    groups: dict[str, set] = {}
    for line in text.splitlines():
        line = line.strip()
        if not line.startswith("- "):
            continue
        key_part, _, value_part = line[2:].partition("：")
        key = key_part.split("（", 1)[0].strip()
        values: set = set()
        for item in value_part.split("；"):
            _, sep, v = item.partition("=")
            if sep:
                values.add(v)
        if key:
            groups[key] = values
    return groups


class TestVocabularyText:
    def test_values_match_effect_values_group_by_group(self):
        """防漂移（核心）：词典文本中的取值集合 == EFFECT_VALUES（逐组比对）。

        文本是字符串媒介，数字预置值（radius 的 8/16/24）按 str 归一后比对。
        """
        groups = _parse_groups(vocabulary_text())
        assert set(groups) == set(EFFECT_KEYS), "词典组集合必须与白名单 key 集合一致"
        for key in EFFECT_KEYS:
            expected = {str(v) for v in EFFECT_VALUES[key]}
            assert groups[key] == expected, f"组 {key} 的取值集合与白名单不一致"

    def test_keys_labels_and_value_labels_all_present(self):
        """每组输出 key + 中文 label；每个预置值的 label 与 value 都出现。"""
        text = vocabulary_text()
        for spec in WHITELIST["keys"]:
            assert spec["key"] in text, spec["key"]
            assert spec["label"] in text, spec["label"]
            for v in spec["values"]:
                assert v["label"] in text, v["label"]
                assert str(v["value"]) in text, v["value"]

    def test_generated_not_transcribed(self):
        """防漂移：给 WHITELIST 临时追加假预置 → 重新生成词典应包含它（生成而非抄写）。"""
        fake = {"value": "0 999px 999px rgba(1,2,3,0.99)", "label": "假阴影"}
        shadow_spec = next(k for k in WHITELIST["keys"] if k["key"] == "shadow")
        shadow_spec["values"].append(fake)
        try:
            text = vocabulary_text()
            assert fake["value"] in text
            assert fake["label"] in text
        finally:
            shadow_spec["values"].remove(fake)

    def test_changes_size_groups_flagged(self):
        """changesSize=True 的组带「可能改变尺寸，应用前需用户确认」提示；其余组不带。"""
        text = vocabulary_text()
        assert text, "词典文本不能为空"
        for spec in WHITELIST["keys"]:
            line = next(l for l in text.splitlines() if l.lstrip().startswith(f"- {spec['key']}"))
            if EFFECT_CHANGES_SIZE[spec["key"]]:
                assert "可能改变尺寸" in line, spec["key"]
                assert "用户确认" in line, spec["key"]
            else:
                assert "可能改变尺寸" not in line, spec["key"]

    def test_deterministic(self):
        """同 WHITELIST 同输出（连续两次调用一致）。"""
        assert vocabulary_text() == vocabulary_text()
