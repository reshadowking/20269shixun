"""T49（C6）：可渲染 style 键的提示词文本（与前端同源，防写错键）。

为什么需要：ops 的 `set_style` 接受任意键，而渲染层只认固定的一批键——模型写
`boxShadow` / `borderRadius` / `backgroundColor` 这类近义写法时，以前会被静默丢弃
（"已改动 N 处"但画布不动）。前端现在做了别名归一兜住常见近义写法，但**从源头**
告诉模型"能用哪些键"更省事，也更少出现自创 CSS 属性。

单一来源：`shared/style-keys.json`（与 `frontend/src/design/styleKeys.ts` 同一份）。
本模块不做模块级缓存：改 JSON（或测试里改后重新生成）必须立即生效，防漂移测试才观测得到。
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent.parent
STYLE_KEYS_FILE = ROOT / "shared" / "style-keys.json"

with STYLE_KEYS_FILE.open(encoding="utf-8") as _f:
    SPEC: dict = json.load(_f)


def renderable_keys() -> list[str]:
    return list(SPEC.get("renderable") or [])


def style_keys_text() -> str:
    """生成"可用样式键"提示段（含中文名与别名提示）。"""
    items = []
    labels = SPEC.get("labels") or {}
    for key in renderable_keys():
        label = labels.get(key)
        items.append(f"{key}（{label}）" if label else key)
    aliases = list((SPEC.get("aliases") or {}).keys())
    alias_note = (
        f"近义写法（{'、'.join(aliases[:6])} 等）会自动归一，但请优先用上面的规范键名。"
        if aliases
        else ""
    )
    return (
        "、".join(items)
        + "\n不在清单里的 style 键渲染不出来（回执里会标注为未生效，别写自创 CSS 属性）。"
        + (alias_note or "")
    )
