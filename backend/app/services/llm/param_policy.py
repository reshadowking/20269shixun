"""参数策略：drop / clamp / rename，按 (profile, api_format) 二维应用。

为什么是二维：**协议规范差异**（clamp 范围、字段改名）与**厂商差异**（某家不接受某参数）
是两个独立维度。同一家厂商横跨两个协议族（DeepSeek/Kimi 的 chat 与 anthropic），
两边的策略并不相同。

合并语义（`resolve_policy`）：**协议提供默认，厂商按键覆盖**。

    drop   = 协议 drop ∪ 厂商 drop（并集：谁都不能"取消"别人的删除）
    clamp  = {**协议.clamp, **厂商.clamp}（**键级替换**）
    rename = {**协议.rename, **厂商.rename}

"键级替换"而不是"顺序叠加"是被测试逼出来的：DeepSeek 的 anthropic 端点官方文档写明
temperature 支持 0~2，而 Anthropic 协议默认是 0~1。若顺序叠加，1.5 会先被协议夹到 1.0，
厂商的 (0,2) 再也救不回来——"厂商可覆盖协议默认"就成了空话。

层内顺序固定：drop → clamp → rename。**drop 必须先于 clamp**——被 drop 的参数不该再被
夹（"Kimi 的请求体里没有 temperature"正是靠这条成立）。
"""
from dataclasses import dataclass, field


@dataclass(frozen=True)
class ParamPolicy:
    """单层参数策略：先删、再夹、末改名（同一层内的顺序同此）。"""

    drop: tuple[str, ...] = ()
    clamp: dict[str, tuple[float, float]] = field(default_factory=dict)
    rename: dict[str, str] = field(default_factory=dict)


def apply(params: dict, policy: ParamPolicy) -> dict:
    """应用一层策略（不改原字典）。"""
    out = dict(params)
    for key in policy.drop:
        out.pop(key, None)
    for key, (low, high) in policy.clamp.items():
        value = out.get(key)
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            continue
        clamped = min(max(float(value), low), high)
        # 整数参数保持整数（避免 max_tokens 之类被夹成 16384.0）
        out[key] = int(clamped) if isinstance(value, int) and clamped.is_integer() else clamped
    for src, dst in policy.rename.items():
        if src in out:
            out[dst] = out.pop(src)
    return out


def resolve_policy(vendor: ParamPolicy, protocol: ParamPolicy) -> ParamPolicy:
    """协议默认 + 厂商覆盖（键级替换，语义见模块 docstring）。"""
    return ParamPolicy(
        drop=tuple(dict.fromkeys((*protocol.drop, *vendor.drop))),
        clamp={**protocol.clamp, **vendor.clamp},
        rename={**protocol.rename, **vendor.rename},
    )


def apply_layers(params: dict, vendor: ParamPolicy, protocol: ParamPolicy) -> dict:
    """应用"协议默认 + 厂商覆盖"合并后的策略（层内顺序 drop → clamp → rename）。"""
    return apply(params, resolve_policy(vendor, protocol))
