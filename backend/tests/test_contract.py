"""B0 防漂移护栏：shared 单一来源契约测试（优化路线图 §3 B0-1/B0-3）。

- schema 组件集合 == component-library 组件集合（绿，新增组件必须双写并由本文件把关）；
- lib 声明 enum 的 props 字段，schema 必须提供一致 enum（当前红灯：variant/size/type_）。

红灯管理：`KNOWN_GAPS` 列出当前已知缺口并 xfail（B1-3 合法集合收敛时移除对应项并让断言转正），
避免护栏本身让 CI 常红；缺口外的任何新不一致都会直接失败。
"""
import json
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent.parent
SCHEMA = json.loads((ROOT / "shared" / "design-schema.json").read_text(encoding="utf-8"))
LIB = json.loads((ROOT / "shared" / "component-library.json").read_text(encoding="utf-8"))

SCHEMA_COMPONENTS = set(SCHEMA["properties"]["componentType"]["enum"])
LIB_COMPONENTS = {c["type"] for c in LIB["components"]}
SCHEMA_PROPS = SCHEMA["properties"]["props"]["properties"]

# B1-3 转正项：lib 声明了 enum、schema 仍为自由字符串的 props 字段
# （P14 前置决策卡定 variant 合法集合后，schema 补 enum 并移出本集合）
KNOWN_GAPS = {"variant", "size", "type_"}

# (组件类型, 字段, lib enum) —— lib 中所有声明 enum 的 props 字段
ENUM_CASES = [
    (c["type"], field, spec["enum"])
    for c in LIB["components"]
    for field, spec in (c.get("props") or {}).items()
    if spec.get("enum") is not None
]


def test_component_sources_agree():
    """schema 组件集合与组件库组件集合一致。"""
    assert SCHEMA_COMPONENTS == LIB_COMPONENTS


def test_lib_props_fields_covered_by_schema():
    """lib 组件声明的全部 props 字段都必须存在于 schema props 声明（防漏字段）。"""
    lib_fields = {f for c in LIB["components"] for f in (c.get("props") or {})}
    missing = lib_fields - set(SCHEMA_PROPS)
    assert not missing, f"lib 字段不在 schema props 中: {sorted(missing)}"


@pytest.mark.parametrize("ctype,field,enum", ENUM_CASES, ids=[f"{c}-{f}" for c, f, _ in ENUM_CASES])
def test_lib_enum_matches_schema(ctype, field, enum):
    """lib 声明 enum 的字段，schema 必须给出完全一致的 enum。

    level 例外：schema 用 number min1/max6 表达 h1-h6，与 lib enum [1..6] 语义等价。
    """
    schema_spec = SCHEMA_PROPS.get(field) or {}
    if field == "level":
        assert schema_spec.get("minimum") == min(enum), f"{ctype}.{field}: schema 下限 {schema_spec.get('minimum')}"
        assert schema_spec.get("maximum") == max(enum), f"{ctype}.{field}: schema 上限 {schema_spec.get('maximum')}"
        return
    if field in KNOWN_GAPS:
        pytest.xfail(f"B1-3 转正项：schema.props.{field} 缺 enum（{ctype} 声明 {enum}）——见优化路线图 §7 步骤 1/4")
    assert schema_spec.get("enum") == enum, f"{ctype}.{field}: schema {schema_spec.get('enum')} != lib {enum}"
