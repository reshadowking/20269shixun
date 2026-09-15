"""T22：进程内熔断器（滑动窗口 + 半开探测）。

规则：最近 20 次真实调用里样本 ≥5 且失败率 ≥0.6，或连续失败 ≥5 次 → 打开 30s；
打开期间不再调用模型（上层直接走模板兜底并如实告知）；到期后放行 1 次探测，
成功即闭合。mock 模式不计入（没有网络调用）。
已知限制：进程内实现，重启即清零，多 worker 各自计数。
"""
import time
from collections import deque

from ..config import get_settings

_failures: deque[bool] = deque(maxlen=20)
_consecutive = 0
_opened_until = 0.0
_probe_taken = False


def record(ok: bool) -> None:
    """记录一次真实调用结果（没有真正调用模型的情况不要调用本函数）。"""
    global _consecutive, _opened_until
    settings = get_settings()
    _failures.append(not ok)
    _consecutive = 0 if ok else _consecutive + 1
    if ok and _probe_taken:
        _reset_for_tests()
        return
    if not ok and _probe_taken:
        # 半开探测失败：立刻重新打开（不用等再次凑够样本）
        _opened_until = time.monotonic() + settings.ai_breaker_open_seconds
        return
    ratio = sum(1 for f in _failures if f) / len(_failures)
    if _consecutive >= settings.ai_breaker_min_samples or (
        len(_failures) >= settings.ai_breaker_min_samples and ratio >= settings.ai_breaker_fail_ratio
    ):
        _opened_until = time.monotonic() + settings.ai_breaker_open_seconds


def is_open() -> bool:
    """是否应跳过模型调用；到期后的第一次询问返回 False（放行探测）。"""
    global _probe_taken
    if _opened_until <= 0:
        return False
    if time.monotonic() < _opened_until:
        return True
    # 到期：闭合进入半开——放行后续调用作为探测；探测失败时 record() 会立刻重新打开
    _probe_taken = True
    return False


def state() -> str:
    return "open" if _opened_until > 0 and time.monotonic() < _opened_until else "closed"


def _reset_for_tests() -> None:
    global _consecutive, _opened_until, _probe_taken
    _failures.clear()
    _consecutive = 0
    _opened_until = 0.0
    _probe_taken = False
