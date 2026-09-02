#!/usr/bin/env python3
"""还原度评测脚本（P0-3）：对比 DesignNode 设计树与导出代码，计算结构还原度。

指标（三指标之一：一键转代码前端还原度 ≥70%）：
  还原度 = 0.4×组件数一致率 + 0.4×文本一致率 + 0.2×结构一致率

- 组件数一致率：设计树中 15 种组件类型的出现次数 vs 导出代码中对应标签的出现次数
- 文本一致率：设计树中的用户文本出现在导出代码中的比例（含 HTML 转义还原）
- 结构一致率：容器（frame）嵌套深度比 与 容器数量比 的平均

用法：
  python scripts/eval_export_quality.py --input scripts/designs --output report.json
  python scripts/eval_export_quality.py --design x.json --code App.tsx   # 单文件对比

说明：--input 目录下的设计稿 JSON 若无对应导出代码，脚本用内置 Python 生成器
（与前端 designToReact 映射逻辑一致：frame→div、button→<button> 等）产出代码再对比，
保证一键可跑；真实场景可先用前端导出 zip 再传入 --code 对比。
"""
import argparse
import html
import json
import re
import sys
from pathlib import Path

# 组件类型 → 导出代码标签（与前端 export/designToReact.ts 映射一致）
COMPONENT_TAG = {
    "button": "button",
    "card": "div",
    "input": "input",
    "select": "select",
    "table": "table",
    "chart": "div",
    "stat-block": "div",
    "navbar": "nav",
    "sidebar": "aside",
    "avatar": "div",
    "tag": "span",
    "divider": "hr",
    "title-text": "h",
    "hero": "section",
    "image": "img",
}

TAG_RE = re.compile(r"<(/?)([a-zA-Z][a-zA-Z0-9-]*)[^>]*>")
TEXT_RE = re.compile(r">([^<>]+?)<")


def _walk(node: dict):
    yield node
    for child in node.get("children") or []:
        yield from _walk(child)


def extract_from_design(design: dict) -> dict:
    """从设计树提取：组件类型计数、用户文本、容器深度。"""
    components: dict[str, int] = {}
    texts: list[str] = []
    max_depth = 0

    def walk(node: dict, depth: int) -> None:
        nonlocal max_depth
        # 深度从 1 计（root frame 算第 1 层，与代码端 root div 对齐）
        max_depth = max(max_depth, depth + 1)
        if node.get("type") == "component":
            ctype = node.get("componentType")
            if ctype in COMPONENT_TAG:
                components[ctype] = components.get(ctype, 0) + 1
            props = node.get("props") or {}
            # 收集组件中的用户可见文本（text/title/content/label/value 等）
            for key in ("text", "title", "content", "label", "value", "subtitle", "placeholder", "trend"):
                value = props.get(key)
                if isinstance(value, str) and value.strip():
                    texts.append(value.strip())
            # 数组类文本（links/items/rows 的 label/title/文本；table 单元格；chart 标签）
            for key in ("links", "items"):
                for item in props.get(key) or []:
                    if isinstance(item, dict):
                        for k in ("label", "title", "text"):
                            v = item.get(k)
                            if isinstance(v, str) and v.strip():
                                texts.append(v.strip())
            for row in props.get("rows") or []:
                if isinstance(row, dict):
                    for v in row.values():
                        if isinstance(v, str) and v.strip():
                            texts.append(v.strip())
            for col in props.get("columns") or []:
                if isinstance(col, dict) and isinstance(col.get("title"), str) and col["title"].strip():
                    texts.append(col["title"].strip())
            if isinstance(props.get("data"), list) and isinstance(props.get("xKey"), str):
                for d in props["data"]:
                    if isinstance(d, dict) and isinstance(d.get(props["xKey"]), str) and d[props["xKey"]].strip():
                        texts.append(d[props["xKey"]].strip())
        elif node.get("type") == "text":
            value = (node.get("props") or {}).get("text")
            if isinstance(value, str) and value.strip():
                texts.append(value.strip())
        for child in node.get("children") or []:
            walk(child, depth + 1)

    walk(design, 0)
    return {"components": components, "texts": texts, "max_depth": max_depth, "container_count": _container_count(design)}


def _container_count(node: dict) -> int:
    count = 1 if node.get("type") in ("frame", "group") else 0
    for child in node.get("children") or []:
        count += _container_count(child)
    return count


def extract_from_code(code: str) -> dict:
    """从导出代码提取：标签计数、可见文本、嵌套深度。"""
    tags: dict[str, int] = {}
    depth = 0
    max_depth = 0
    for match in TAG_RE.finditer(code):
        closing, tag = match.group(1), match.group(2)
        if not closing:
            if tag == "div" and "data-component" in match.group(0):
                continue  # 组件标记 div：不是布局容器，不计深度
            depth += 1
            max_depth = max(max_depth, depth)
            tags[tag] = tags.get(tag, 0) + 1
        else:
            depth = max(0, depth - 1)
    texts = [html.unescape(t.strip()) for t in TEXT_RE.findall(code) if t.strip()]
    # 容器数 = 布局 div 数（组件标记 div 已被跳过）
    return {"tags": tags, "texts": texts, "max_depth": max_depth, "container_count": tags.get("div", 0)}


def component_rate(design_components: dict[str, int], code_tags: dict[str, int]) -> float:
    """组件数一致率：每个组件类型的数量差异加权。"""
    totals = 0
    matched = 0
    for ctype, count in design_components.items():
        expected_tag = COMPONENT_TAG[ctype]
        code_count = code_tags.get(expected_tag, 0)
        if ctype == "title-text":
            # h1-h6 都算标题
            code_count = sum(v for k, v in code_tags.items() if k.startswith("h"))
        totals += count
        matched += min(count, code_count)
    return matched / totals if totals else 1.0


def text_rate(design_texts: list[str], code_texts: list[str]) -> float:
    """文本一致率：设计树文本出现在导出代码中的比例。"""
    if not design_texts:
        return 1.0
    code_set = set(code_texts)
    matched = sum(1 for t in design_texts if t in code_set)
    return matched / len(design_texts)


def structure_rate(design: dict, code: dict) -> float:
    """结构一致率：深度比 + 容器数比。"""
    depth_ratio = min(design["max_depth"], code["max_depth"]) / max(design["max_depth"], code["max_depth"]) if max(design["max_depth"], code["max_depth"]) else 1.0
    container_ratio = min(design["container_count"], code["container_count"]) / max(design["container_count"], code["container_count"]) if max(design["container_count"], code["container_count"]) else 1.0
    return (depth_ratio + container_ratio) / 2


def evaluate(design: dict, code: str) -> dict:
    """计算单个设计稿的还原度报告。"""
    d = extract_from_design(design)
    c = extract_from_code(code)
    comp = component_rate(d["components"], c["tags"])
    text = text_rate(d["texts"], c["texts"])
    struct = structure_rate(d, c)
    overall = 0.4 * comp + 0.4 * text + 0.2 * struct
    return {
        "component_rate": round(comp, 4),
        "text_rate": round(text, 4),
        "structure_rate": round(struct, 4),
        "overall": round(overall, 4),
        "detail": {
            "design_components": d["components"],
            "code_tags": c["tags"],
            "missing_texts": [t for t in d["texts"] if t not in set(c["texts"])],
        },
    }


def python_generate_code(design: dict) -> str:
    """内置导出生成器（与前端 designToReact 映射一致），供无导出代码时自产自比。"""
    lines: list[str] = []

    def node_to_code(node: dict, depth: int) -> None:
        pad = "  " * depth
        style = node.get("style") or {}
        if node.get("type") == "text":
            text = (node.get("props") or {}).get("text", "")
            lines.append(f'{pad}<div style={{"{style}"}}>{html.escape(str(text))}</div>')
            return
        if node.get("type") == "component":
            ctype = node.get("componentType")
            tag = COMPONENT_TAG.get(ctype, "div")
            props = node.get("props") or {}
            if ctype == "title-text":
                level = min(max(int(props.get("level") or 2), 1), 6)
                lines.append(f'{pad}<h{level} style={{"{style}"}}>{html.escape(str(props.get("text", "")))}</h{level}>')
            elif ctype == "button":
                lines.append(f'{pad}<button style={{"{style}"}}>{html.escape(str(props.get("text", "")))}</button>')
            elif ctype == "input":
                label = props.get("label")
                label_html = f'<label>{html.escape(str(label))}</label>' if label else ""
                lines.append(f'{pad}<div data-component="input">{label_html}<input style={{"{style}"}} placeholder="{html.escape(str(props.get("placeholder", "")))}" /></div>')
            elif ctype == "image":
                lines.append(f'{pad}<img style={{"{style}"}} src="{html.escape(str(props.get("src", "")))}" />')
            elif ctype == "table":
                columns = props.get("columns") or []
                rows = props.get("rows") or []
                head = "".join(f"<th>{html.escape(str(c.get('title', '')))}</th>" for c in columns if isinstance(c, dict))
                body = "".join(
                    "<tr>" + "".join(f"<td>{html.escape(str(r.get(str(c.get('key', '')), '')))}</td>" for c in columns if isinstance(c, dict)) + "</tr>"
                    for r in rows if isinstance(r, dict)
                )
                lines.append(f'{pad}<table data-component="table" style={{"{style}"}}><thead><tr>{head}</tr></thead><tbody>{body}</tbody></table>')
            elif ctype == "chart":
                data = props.get("data") or []
                x_key = str(props.get("xKey") or "name")
                y_key = str(props.get("yKey") or "value")
                title = html.escape(str(props.get("title") or ""))
                bars = "".join(f'<div style={{"flex:1;background:#3D7FFF;height:60px"}} title="{html.escape(str(d.get(x_key, "")))}">{html.escape(str(d.get(y_key, "")))}</div>' for d in data if isinstance(d, dict))
                labels = "".join(f'<span>{html.escape(str(d.get(x_key, "")))}</span>' for d in data if isinstance(d, dict))
                lines.append(f'{pad}<div data-component="chart" style={{"{style}"}}><div data-component="chart-inner">{title}</div><div data-component="chart-inner" style={{"display:flex;gap:12px"}}>{bars}</div><div data-component="chart-inner" style={{"display:flex;gap:12px"}}>{labels}</div></div>')
            elif ctype == "navbar":
                title = html.escape(str(props.get("title", "")))
                links = "".join(
                    f'<a href="{html.escape(str(item.get("href", "#")))}">{html.escape(str(item.get("label", "")))}</a>'
                    for item in (props.get("links") or []) if isinstance(item, dict)
                )
                lines.append(f"{pad}<nav style={{\"{style}\"}}><strong>{title}</strong>{links}</nav>")
            else:
                text = html.escape(str(props.get("text", "") or props.get("title", "") or ""))
                lines.append(f'{pad}<{tag} data-component="{ctype}" style={{"{style}"}}>{text}</{tag}>')
            return
        # frame/group：子节点递归
        lines.append(f'{pad}<div style={{"{style}"}}>')
        for child in node.get("children") or []:
            if not child.get("hidden"):
                node_to_code(child, depth + 1)
        lines.append(f"{pad}</div>")

    node_to_code(design, 0)
    return "\n".join(lines)


def run(input_dir: Path, output_path: Path) -> dict:
    """批量评测目录下所有设计稿 JSON。"""
    reports: dict[str, dict] = {}
    output_name = output_path.name
    for design_file in sorted(input_dir.glob("*.json")):
        if design_file.name == output_name:
            continue  # 跳过报告文件本身
        design = json.loads(design_file.read_text(encoding="utf-8"))
        # 同目录下同名 .tsx / .html 作为导出代码；没有则用内置生成器
        code_file = design_file.with_suffix(".tsx")
        if not code_file.exists():
            code_file = design_file.with_suffix(".html")
        code = code_file.read_text(encoding="utf-8") if code_file.exists() else python_generate_code(design)
        reports[design_file.stem] = evaluate(design, code)
        print(f"{design_file.stem}: 还原度 {reports[design_file.stem]['overall']:.1%} "
              f"(组件 {reports[design_file.stem]['component_rate']:.1%} / 文本 {reports[design_file.stem]['text_rate']:.1%} / 结构 {reports[design_file.stem]['structure_rate']:.1%})")
    report = {"reports": reports, "average": round(sum(r["overall"] for r in reports.values()) / len(reports), 4) if reports else 0}
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"报告已写入: {output_path} | 平均还原度 {report['average']:.1%}")
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description="导出还原度评测（P0-3）")
    parser.add_argument("--input", type=Path, default=Path("scripts/designs"), help="设计稿 JSON 目录")
    parser.add_argument("--output", type=Path, default=Path("report.json"), help="报告输出路径")
    parser.add_argument("--design", type=Path, help="单个设计稿 JSON（与 --code 搭配）")
    parser.add_argument("--code", type=Path, help="单个导出代码文件")
    args = parser.parse_args()

    if args.design and args.code:
        design = json.loads(args.design.read_text(encoding="utf-8"))
        result = evaluate(design, args.code.read_text(encoding="utf-8"))
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0
    return 0 if run(args.input, args.output) else 1


if __name__ == "__main__":
    sys.exit(main())
