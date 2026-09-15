"""B0 防漂移护栏：shared 单一来源契约测试（优化路线图 §3 B0-1/B0-3）。

- schema 组件集合 == component-library 组件集合；
- lib 声明 enum 的 props 字段，schema 必须提供一致 enum（P14 决策卡落地后 variant/size/type_
  已补 enum 转正；level 以 number min/max 表达 h1-h6 语义等价）。
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


def test_explore_response_documented_in_openapi():
    """缺口清单 §4.10 #19：/api/generate/explore 必须有 response_model——
    此前 200 响应 schema 为空 {}，degraded_kinds 在机器可读契约里不可见。"""
    from app.main import app

    spec = app.openapi()
    gen = spec["paths"]["/api/generate/explore"]["post"]
    resp = gen["responses"]["200"]["content"]["application/json"]["schema"]
    assert resp.get("$ref") == "#/components/schemas/ExploreResponse", f"explore 200 响应未文档化: {resp}"
    option = spec["components"]["schemas"]["ExploreResponse"]["properties"]["options"]["items"]
    assert option.get("$ref") == "#/components/schemas/ExploreOptionModel"
    assert "degraded_kinds" in spec["components"]["schemas"]["ExploreOptionModel"]["properties"]


def test_generate_node_keys_match_schema():
    """T8 收尾（缺口清单 §4.8）：repair_design 的键裁剪白名单必须与 Schema 节点键集合逐一相等——
    白名单缺键会裁掉合法字段（静默丢数据），多键则裁剪失效（Additional properties 报错复发）。"""
    from app.services.generate import NODE_KEYS

    assert set(NODE_KEYS) == set(SCHEMA["properties"].keys())


def test_generate_component_type_names_in_sync():
    """T8 §4.4：generate.py 手写的 COMPONENT_TYPE_NAMES 必须与 schema/lib 一致——
    否则 §8 真扩充组件库时（如加 icon），repair 会把刚合法的新组件降级成 frame（静默消失）。"""
    from app.services.generate import COMPONENT_TYPE_NAMES

    assert set(COMPONENT_TYPE_NAMES) == SCHEMA_COMPONENTS == LIB_COMPONENTS


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
    assert schema_spec.get("enum") == enum, f"{ctype}.{field}: schema {schema_spec.get('enum')} != lib {enum}"
