"""宽容化修复测试：LLM 常见格式错误（组件名误写进 type）修复后保留整棵树，不整棵回退。"""

import json

from app.design.validator import validate_design
from app.services.generate import generate_design, repair_design
from app.services.llm import LLMClient


class TestRepairDesign:
    def test_component_name_in_type_fixed(self):
        """{"type":"divider"} → {"type":"component","componentType":"divider"}"""
        fixed = repair_design({"id": "d", "type": "divider"})
        assert fixed["type"] == "component"
        assert fixed["componentType"] == "divider"

    def test_known_basic_types_untouched(self):
        for t in ("frame", "text", "rect", "component"):
            node = {"id": "x", "type": t}
            assert repair_design(node)["type"] == t

    def test_group_normalized_to_frame(self):
        """基元开放决策：group 与 frame 渲染同分支（画面零差异），面板只开放 frame——
        新稿不再产生 group：裸 type:"group" 与 componentType:"group" 两种写法落地时都
        归一化为 frame，props/children 保留。schema enum 与渲染层的 group 分支保留仅为旧稿兼容。"""
        bare = repair_design({"id": "g1", "type": "group", "props": {"name": "旧分组"}, "children": [{"id": "c", "type": "text"}]})
        assert bare["type"] == "frame"
        assert bare["props"]["name"] == "旧分组"
        assert bare["children"][0]["id"] == "c"
        via_ct = repair_design({"id": "g2", "type": "component", "componentType": "group"})
        assert via_ct["type"] == "frame"
        assert "componentType" not in via_ct

    def test_component_type_without_type(self):
        fixed = repair_design({"id": "b", "componentType": "button"})
        assert fixed["type"] == "component"
        assert fixed["componentType"] == "button"

    def test_recursive_fix(self):
        tree = {
            "id": "root", "type": "frame",
            "children": [
                {"id": "nav", "type": "navbar"},  # 深层错误也要修
                {"id": "ok", "type": "text"},
            ],
        }
        fixed = repair_design(tree)
        assert fixed["children"][0] == {"id": "nav", "type": "component", "componentType": "navbar"}
        assert fixed["children"][1]["type"] == "text"

    def test_unknown_bare_type_degraded_to_frame(self):
        """T8（spec 变更，取代旧 test_unknown_type_stays_unchanged）：裸未知 type 降级 frame——
        坏节点不再拖垮整棵树；保留 id，降级后过 Schema。（T9 起示例用 pagination：tabs 已合法）"""
        fixed = repair_design({"id": "x", "type": "pagination"})
        assert fixed["type"] == "frame"
        assert fixed["id"] == "x"
        validate_design(fixed)

    def test_unknown_component_type_degraded_to_frame(self):
        """T8 核心用例：模型自创白名单外 componentType（T9 起 icon 已合法，示例改用
        仍处白名单外的 pagination）→ 降级 frame，保留 id/style/children。"""
        node = {
            "id": "ic", "type": "component", "componentType": "pagination",
            "style": {"width": 24, "color": "text-light"},
            "children": [{"id": "c", "type": "text", "props": {"text": "✓"}}],
        }
        fixed = repair_design(node)
        assert fixed["type"] == "frame"
        assert "componentType" not in fixed
        assert fixed["id"] == "ic"
        assert fixed["style"]["width"] == 24
        assert fixed["children"][0]["props"]["text"] == "✓"
        validate_design(fixed)  # 红：现状原样放行 → 校验失败

    def test_switch_stays_component_and_checked_type_repaired(self):
        """T9：switch 合法化（不再降级）；checked 给错类型（字符串 "true"）→ 删除该字段
        用默认值渲染（§2.2：PROPS_BOOL_FIELDS 已收 checked），不整树回退。"""
        fixed = repair_design({"id": "s", "type": "component", "componentType": "switch", "props": {"checked": True, "label": "接收通知"}})
        assert fixed["type"] == "component"
        assert fixed["props"]["checked"] is True
        validate_design(fixed)
        bad_bool = repair_design({"id": "s", "type": "component", "componentType": "switch", "props": {"checked": "true"}})
        assert "checked" not in bad_bool["props"]
        validate_design(bad_bool)

    def test_degrade_salvages_visible_text(self):
        """T8 §4.2：降级时 props.text 有可见内容 → 抢救为 text 子节点（追加末尾），其余 props 删除。"""
        node = {"id": "ic", "type": "component", "componentType": "pagination", "props": {"text": "★"}}
        fixed = repair_design(node)
        assert fixed["type"] == "frame"
        assert "props" not in fixed
        assert fixed["children"] == [{"id": "ic-salvaged", "type": "text", "props": {"text": "★"}}]
        validate_design(fixed)

    def test_unknown_node_key_trimmed(self):
        """T8 §4.1-4（历史报错真凶）：节点级未知键（content 等）裁剪，不整树回退。"""
        node = {"id": "f", "type": "frame", "content": "hello"}
        fixed = repair_design(node)
        assert "content" not in fixed
        assert fixed["type"] == "frame"
        validate_design(fixed)  # 红：现状 Additional properties not allowed ('content')

    def test_known_components_and_conversion_untouched(self):
        """green-lock：已知组件与 {"type":"button"} 转正路径行为不变，新规则不误伤。"""
        assert repair_design({"id": "b", "type": "divider"}) == {"id": "b", "type": "component", "componentType": "divider"}
        assert repair_design({"id": "c", "type": "component", "componentType": "card"}) == {
            "id": "c", "type": "component", "componentType": "card",
        }
        node = {
            "id": "root", "type": "frame",
            "children": [
                {"id": "b1", "type": "component", "componentType": "button", "props": {"text": "x"}},
                {"id": "u", "type": "component", "componentType": "pagination", "props": {"text": "★"}},
            ],
        }
        fixed = repair_design(node)
        assert fixed["children"][0] == {"id": "b1", "type": "component", "componentType": "button", "props": {"text": "x"}}
        assert fixed["children"][1]["type"] == "frame"

    def test_children_not_list_cleared(self):
        fixed = repair_design({"id": "r", "type": "frame", "children": "oops"})
        assert fixed["children"] == []

    def test_repaired_tree_passes_schema(self):
        tree = {
            "id": "root", "type": "frame", "style": {"layout": "column"},
            "children": [{"id": "d", "type": "divider"}],
        }
        validate_design(repair_design(tree))  # 不抛异常

    def test_radius_out_of_bounds_clamped(self):
        """radius: 100（头像圆形）→ clamp 到 64，不再整树回退。"""
        tree = {
            "id": "root", "type": "frame",
            "children": [{"id": "a", "type": "component", "componentType": "avatar", "style": {"width": 40, "height": 40, "radius": 100}}],
        }
        fixed = repair_design(tree)
        assert fixed["children"][0]["style"]["radius"] == 64
        validate_design(fixed)

    def test_fontsize_and_gap_clamped(self):
        tree = {
            "id": "root", "type": "frame", "style": {"layout": "column", "gap": 300},
            "children": [{"id": "t", "type": "text", "style": {"fontSize": 200}}],
        }
        fixed = repair_design(tree)
        assert fixed["style"]["gap"] == 100
        assert fixed["children"][0]["style"]["fontSize"] == 96
        validate_design(fixed)

    def test_in_range_values_untouched(self):
        tree = {"id": "r", "type": "frame", "style": {"gap": 16, "radius": 12, "fontSize": 14}}
        fixed = repair_design(tree)
        assert fixed["style"] == {"gap": 16, "radius": 12, "fontSize": 14}

    def test_props_size_invalid_enum_deleted(self):
        """props.size 非法（数字 28 / 字符串 'xl'）→ 删除字段（P14 收敛后 size 为 sm/default/lg 枚举，
        不再做数字转字符串——那是 size 还是自由字符串时代的语义）。"""
        tree = {"id": "a", "type": "component", "componentType": "avatar", "props": {"name": "u", "size": 28}}
        fixed = repair_design(tree)
        assert "size" not in fixed["props"]
        validate_design(fixed)
        tree2 = {"id": "b", "type": "component", "componentType": "button", "props": {"text": "x", "variant": "orange", "size": "xl"}}
        fixed2 = repair_design(tree2)
        assert "variant" not in fixed2["props"] and "size" not in fixed2["props"]
        validate_design(fixed2)

    def test_props_level_string_to_number_clamped(self):
        tree = {"id": "t", "type": "component", "componentType": "title-text", "props": {"text": "x", "level": "9"}}
        fixed = repair_design(tree)
        assert fixed["props"]["level"] == 6  # 9 超界 → clamp 6
        validate_design(fixed)

    def test_props_wrong_type_deleted(self):
        tree = {
            "id": "i", "type": "component", "componentType": "input",
            "props": {"label": "账号", "disabled": "yes", "options": "abc"},
        }
        fixed = repair_design(tree)
        assert "disabled" not in fixed["props"]
        assert "options" not in fixed["props"]
        assert fixed["props"]["label"] == "账号"
        validate_design(fixed)


class TestGenerateWithRepair:
    def test_llm_output_with_bad_node_kept_after_repair(self):
        """模型输出只有个别节点格式错 → 修复后整树保留（fallback=False），不再整棵回退。"""
        fill = {
            "id": "gen-root", "type": "frame", "style": {"layout": "column"},
            "children": [
                {"id": "n1", "type": "navbar"},
                {"id": "n2", "type": "component", "componentType": "button", "props": {"text": "确定"}},
                {"id": "n3", "type": "divider"},
            ],
        }

        class Responder:
            def __call__(self, system: str, user: str) -> str:
                return json.dumps(fill, ensure_ascii=False) if "设计生成器" in system else ""

        result = generate_design("登录页", LLMClient(mock_responder=Responder()))
        assert result.fallback is False, result.error
        assert result.design["id"] == "gen-root"
        types = [(c["type"], c.get("componentType")) for c in result.design["children"]]
        assert types == [("component", "navbar"), ("component", "button"), ("component", "divider")]

    def test_unrepairable_output_still_falls_back(self):
        """修复后仍非法 → 回退模板，脏数据不上画布。
        （T8 后 type/componentType 未知可降级；T17 后"根节点缺 id"也已被抢救——
        见 test_unwrap.py。本用例改用仍然不可抢救的形态：整个对象不是设计节点。）"""

        class Responder:
            def __call__(self, system: str, user: str) -> str:
                return json.dumps({"explanation": "x"}, ensure_ascii=False) if "设计生成器" in system else ""

        result = generate_design("登录页", LLMClient(mock_responder=Responder()))
        assert result.fallback is False  # mock 模式不标记降级（回退模板仍生效）
        assert result.design["id"] == "login-root"


class TestUnknownComponentEndToEnd:
    def test_icon_in_tree_no_longer_falls_back(self):
        """T9 端到端（取代 T8 同名降级用例）：icon 进白名单后，模型返回含 icon 的树
        → 不降级（节点保持 component、degraded 为空）、不整树回退。"""

        fill = {
            "id": "gen-root", "type": "frame", "style": {"layout": "column"},
            "children": [
                {"id": "t", "type": "text", "props": {"text": "标题"}},
                {"id": "ic", "type": "component", "componentType": "icon", "props": {"name": "star"}},
            ],
        }

        class Responder:
            def __call__(self, system: str, user: str) -> str:
                return json.dumps(fill, ensure_ascii=False) if "设计生成器" in system else ""

        result = generate_design("登录页", LLMClient(mock_responder=Responder()))
        assert result.fallback is False, result.error
        assert result.design["id"] == "gen-root"  # T8 前整树回退 → login-root
        assert result.design["children"][0]["props"]["text"] == "标题"
        assert result.design["children"][1]["type"] == "component"  # icon 不再降级（T9）
        assert result.design["children"][1]["componentType"] == "icon"
        assert result.degraded == []  # 降级清单为空——本轮最直接的端到端证据


class TestLongPromptEndpoint:
    def test_prompt_up_to_8000_accepted(self, client, auth_headers):
        """2000 字符上限移除：超长需求不再被接口直接拒绝（摘要链路上游）。"""
        long_prompt = "设计一个登录页，" + "详细要求：输入框、按钮、标签、分割线、社交登录。" * 120
        assert len(long_prompt) > 2000
        resp = client.post("/api/generate", json={"prompt": long_prompt}, headers=auth_headers)
        assert resp.status_code == 200, resp.text[:200]
        body = resp.json()
        assert body["template"] in ("login", "free")

    def test_over_8000_rejected(self, client, auth_headers):
        resp = client.post("/api/generate", json={"prompt": "字" * 8001}, headers=auth_headers)
        assert resp.status_code == 422

    def test_long_prompt_questions_endpoint(self, client, auth_headers):
        long_prompt = "做一个页面，" + "补充要求。" * 400
        assert len(long_prompt) > 2000
        resp = client.post("/api/generate/questions", json={"prompt": long_prompt, "mode": "smart"}, headers=auth_headers)
        assert resp.status_code == 200


class TestEnumRepair:
    def test_style_align_stretch_removed(self):
        """align:'stretch'（alignItems 的值误写进 align）→ 删除字段，不整树回退。"""
        tree = {
            "id": "root", "type": "frame",
            "children": [{"id": "b", "type": "text", "style": {"align": "stretch"}}],
        }
        fixed = repair_design(tree)
        assert "align" not in fixed["children"][0]["style"]
        validate_design(fixed)

    def test_style_layout_invalid_removed(self):
        tree = {"id": "r", "type": "frame", "style": {"layout": "flow"}}
        fixed = repair_design(tree)
        assert "layout" not in fixed["style"]

    def test_props_charttype_invalid_removed(self):
        tree = {"id": "c", "type": "component", "componentType": "chart", "props": {"chartType": "radar"}}
        fixed = repair_design(tree)
        assert "chartType" not in fixed["props"]
        validate_design(fixed)

    def test_legal_enum_values_kept(self):
        tree = {"id": "r", "type": "frame", "style": {"layout": "row", "align": "center", "alignItems": "stretch"}}
        fixed = repair_design(tree)
        assert fixed["style"] == {"layout": "row", "align": "center", "alignItems": "stretch"}


class TestExtractJsonNestedFence:
    """围栏内嵌套 JSON 提取（非贪婪截断 bug 回归测试）。"""

    def test_nested_json_in_fence(self):
        from app.services.llm import _extract_json

        text = '```json\n{"id": "root", "type": "frame", "children": [{"id": "a", "type": "text", "props": {"text": "x"}}, {"id": "b", "type": "frame", "children": [{"id": "c", "type": "button"}]}]}\n```'
        parsed = _extract_json(text)
        assert parsed is not None
        assert parsed["id"] == "root"
        assert len(parsed["children"]) == 2
        assert parsed["children"][1]["children"][0]["id"] == "c"

    def test_nested_json_plain_text(self):
        from app.services.llm import _extract_json

        text = '好的，设计如下：{"a": {"b": {"c": 1}}} 完成'
        parsed = _extract_json(text)
        assert parsed == {"a": {"b": {"c": 1}}}

    def test_multiple_fences_falls_back_to_full_text(self):
        from app.services.llm import _extract_json

        text = '```json\n{"x": 1}\n```\n```json\n{"y": 2}\n```'
        parsed = _extract_json(text)
        # 贪婪围栏会取到最后一个围栏的完整内容（{"x": 1}\n```\n```json\n{"y": 2} 无法解析）→ 回退全文
        assert parsed in ({"x": 1}, {"y": 2})


class TestChatJsonSelfCorrectRetry:
    def test_retry_with_fix_instruction_uses_second_response(self):
        """第一次输出含未转义引号的坏 JSON → 重试带修复指令 → 第二次合法 JSON 被采用。"""
        from app.services.llm import LLMClient

        bad = '{"id": "root", "type": "text", "props": {"text": "大会名称："2026 AI开发者大会""}}'
        good = '{"id": "root", "type": "text", "props": {"text": "大会名称：「2026 AI开发者大会」"}}'

        class Responder:
            def __init__(self):
                self.calls = 0
                self.second_user_has_fix = False

            def __call__(self, system: str, user: str) -> str:
                self.calls += 1
                if "不是合法 JSON" in user:
                    self.second_user_has_fix = True
                return bad if self.calls == 1 else good

        responder = Responder()
        client = LLMClient(mock_responder=responder)
        parsed = client.chat_json("system", "user", 0.2)
        assert parsed == {"id": "root", "type": "text", "props": {"text": "大会名称：「2026 AI开发者大会」"}}
        assert responder.calls == 2
        assert responder.second_user_has_fix  # 重试确实带了修复指令

    def test_both_attempts_fail_returns_none(self):
        from app.services.llm import LLMClient

        class Responder:
            def __call__(self, system: str, user: str) -> str:
                return "not json at all"

        assert LLMClient(mock_responder=Responder()).chat_json("s", "u") is None


class TestJsonRepair:
    """JSON 轻量修复器（超长输出尾部的尾随/漏逗号）。"""

    def test_trailing_comma_fixed(self):
        from app.services.llm import _extract_json

        text = '{"id": "root", "type": "text", "props": {"text": "你好",},}'
        assert _extract_json(text) == {"id": "root", "type": "text", "props": {"text": "你好"}}

    def test_missing_comma_after_brace_fixed(self):
        from app.services.llm import _extract_json

        # } 后直接跟 "（style 对象结束 → children 键）缺逗号
        text = '{"id": "root", "style": {"width": 700}\n"children": [{"id": "a"}]}'
        parsed = _extract_json(text)
        assert parsed is not None
        assert parsed["id"] == "root"
        assert parsed["children"][0]["id"] == "a"

    def test_missing_comma_in_array_fixed(self):
        from app.services.llm import _extract_json

        # 对象内数组元素间缺逗号（} 后直接跟 {）
        text = '{"id": "root", "children": [{"id": "a"}\n{"id": "b"}]}'
        parsed = _extract_json(text)
        assert parsed is not None
        assert [c["id"] for c in parsed["children"]] == ["a", "b"]

    def test_valid_json_untouched(self):
        from app.services.llm import _extract_json

        text = '{"a": {"b": 1}, "c": [1, 2]}'
        assert _extract_json(text) == {"a": {"b": 1}, "c": [1, 2]}

    def test_unrepairable_returns_none(self):
        from app.services.llm import _extract_json

        assert _extract_json('{"a": }') is None


class TestJsonRepairValueComma:
    """属性值后缺逗号（第二类漏逗号：长输出尾部常见）。"""

    def test_value_newline_key_fixed(self):
        from app.services.llm import _extract_json

        text = '{"id": "root", "style": {"width": 700, "padding": 16\n"margin": 8}, "children": []}'
        parsed = _extract_json(text)
        assert parsed is not None
        assert parsed["style"] == {"width": 700, "padding": 16, "margin": 8}

    def test_string_value_newline_key_fixed(self):
        from app.services.llm import _extract_json

        text = '{"id": "t", "props": {"text": "课程标题"\n"level": 2}}'
        parsed = _extract_json(text)
        assert parsed == {"id": "t", "props": {"text": "课程标题", "level": 2}}

    def test_array_numbers_missing_comma_fixed(self):
        from app.services.llm import _extract_json

        text = '{"data": [1\n2\n3]}'
        parsed = _extract_json(text)
        assert parsed == {"data": [1, 2, 3]}

    def test_legit_last_property_not_broken(self):
        from app.services.llm import _extract_json

        # 最后一个属性后直接 }（合法写法）不被误加逗号
        text = '{"style": {"width": 700, "padding": 16\n}}'
        parsed = _extract_json(text)
        assert parsed == {"style": {"width": 700, "padding": 16}}

    def test_multiline_string_value_not_broken(self):
        from app.services.llm import _extract_json

        # 字符串值内换行（模型错误输出）：修复器不保证救回，但绝不能误判为合法
        text = '{"t": "第一行\n第二行"}'
        assert _extract_json(text) is None  # 非法 JSON 保持失败（交由重试）


class TestPropsObjectRepair:
    def test_action_string_to_object(self):
        """action: "立即学习"（对象字段误写成字符串）→ {"text": "立即学习"}。"""
        from app.services.generate import repair_design

        tree = {"id": "b", "type": "component", "componentType": "button", "props": {"text": "立即学习", "action": "立即学习"}}
        fixed = repair_design(tree)
        assert fixed["props"]["action"] == {"text": "立即学习"}
        validate_design(fixed)

    def test_cta_string_to_object(self):
        from app.services.generate import repair_design

        tree = {"id": "h", "type": "component", "componentType": "hero", "props": {"title": "x", "cta": "立即开始"}}
        fixed = repair_design(tree)
        assert fixed["props"]["cta"] == {"text": "立即开始"}
        validate_design(fixed)

    def test_action_wrong_type_deleted(self):
        from app.services.generate import repair_design

        tree = {"id": "b", "type": "component", "componentType": "button", "props": {"action": 42}}
        fixed = repair_design(tree)
        assert "action" not in fixed["props"]
        validate_design(fixed)


class TestArrayElementRepair:
    def test_links_string_array_to_objects(self):
        """links: ["公司介绍"]（对象数组误写字符串数组）→ [{"label": "公司介绍"}]。"""
        from app.services.generate import repair_design

        tree = {"id": "n", "type": "component", "componentType": "navbar",
                "props": {"title": "x", "links": ["公司介绍", "联系我们"]}}
        fixed = repair_design(tree)
        assert fixed["props"]["links"] == [{"label": "公司介绍"}, {"label": "联系我们"}]
        validate_design(fixed)

    def test_options_object_array_to_strings(self):
        """options 是字符串数组：对象元素提取 label。"""
        from app.services.generate import repair_design

        tree = {"id": "s", "type": "component", "componentType": "select",
                "props": {"options": [{"label": "北京"}, "上海"]}}
        fixed = repair_design(tree)
        assert fixed["props"]["options"] == ["北京", "上海"]
        validate_design(fixed)

    def test_mixed_wrong_types_coerced(self):
        from app.services.generate import repair_design

        tree = {"id": "n", "type": "component", "componentType": "navbar", "props": {"links": [123, {"label": "OK", "href": "#"}]}}
        fixed = repair_design(tree)
        assert fixed["props"]["links"] == [{"label": "123"}, {"label": "OK", "href": "#"}]
        validate_design(fixed)


class TestChildrenRepair:
    def test_missing_id_generated(self):
        """children 元素缺 id（模型把链接对象直接当子节点）→ 派生 id。"""
        from app.services.generate import repair_design

        tree = {"id": "root", "type": "frame", "children": [{"type": "text", "props": {"text": "首页"}}]}
        fixed = repair_design(tree)
        assert fixed["children"][0]["id"] == "root-c0"
        validate_design(fixed)

    def test_string_child_to_text_node(self):
        """children 里的字符串元素（模型把菜单项直接写进 children）→ text 节点。"""
        from app.services.generate import repair_design

        tree = {"id": "root", "type": "frame", "children": ["首页", {"id": "b", "type": "text", "props": {"text": "x"}}]}
        fixed = repair_design(tree)
        assert fixed["children"][0] == {"id": "root-c0", "type": "text", "props": {"text": "首页"}}
        validate_design(fixed)

    def test_normal_children_untouched(self):
        from app.services.generate import repair_design

        tree = {"id": "root", "type": "frame", "children": [{"id": "a", "type": "text", "props": {"text": "x"}}]}
        assert repair_design(tree) == tree


class TestNodeTypeInComponentType:
    """T51 验收反馈：模型会把"节点类型"写进 componentType（实测 componentType:"text" ×3）。

    此前直接降级成空 frame（props 丢失、白包一层）——而该能力本来就存在
    （type:"text" 就是它）。与既有"组件名误写进 type → 转正为组件"互为对称。
    """

    def test_component_type_text_promotes_to_text_node(self):
        node = {"id": "coupon-sub", "type": "component", "componentType": "text", "props": {"text": "副标题"}}
        fixed = repair_design(node)
        assert fixed["type"] == "text"
        assert "componentType" not in fixed
        assert fixed["props"]["text"] == "副标题"  # props 不再被降级流程丢掉

    def test_component_type_rect_frame_also_promote(self):
        for ct in ("rect", "frame"):
            fixed = repair_design({"id": "n", "type": "component", "componentType": ct})
            assert fixed["type"] == ct, ct
        # group 同样转正，但转正后归一化为 frame（见 test_group_normalized_to_frame）

    def test_unknown_component_still_degrades(self):
        """真缺失的能力（pagination）仍降级进 degraded 清单——缺口信号不能被转正吞掉。"""
        degraded: list[str] = []
        fixed = repair_design(
            {"id": "p1", "type": "component", "componentType": "pagination", "props": {"text": "1 2 3"}},
            degraded,
        )
        assert fixed["type"] == "frame"  # 降级
        assert "pagination@p1" in degraded
