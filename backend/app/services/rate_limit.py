"""T22：进程内令牌桶限流（按用户 + 全局，单位：次/分钟）。

调用方（路由层）负责把 `RateLimited` 转成 429。mock 模式同样受限——它保护的是本进程，
不只是模型额度。已知限制：进程内实现，多 worker 各自计数。
"""
import time

from ..config import get_settings


class RateLimited(RuntimeError):
    """超出生成频率限制。"""


_user_buckets: dict[str, tuple[float, float]] = {}
_global_bucket: tuple[float, float] = (0.0, 0.0)


def _take(state: tuple[float, float], capacity: int, now: float, cost: int) -> tuple[bool, tuple[float, float]]:
    tokens, last = state
    refreshed = min(float(capacity), tokens + (now - last) * capacity / 60.0) if last else float(capacity)
    if refreshed >= cost:
        return True, (refreshed - cost, now)
    return False, (refreshed, now)


def check(user: str, cost: int = 1) -> None:
    """扣减额度；不足则抛 `RateLimited`（explore 传 cost=2，它实际是两条链路）。"""
    global _global_bucket
    settings = get_settings()
    now = time.monotonic()
    ok, _global_bucket = _take(_global_bucket, settings.ai_global_rate_limit_per_minute, now, cost)
    if not ok:
        raise RateLimited("生成过于频繁，请稍后再试")
    user_ok, bucket = _take(_user_buckets.get(user, (0.0, 0.0)), settings.ai_rate_limit_per_minute, now, cost)
    _user_buckets[user] = bucket
    if not user_ok:
        raise RateLimited(f"生成过于频繁，请稍后再试（限制 {settings.ai_rate_limit_per_minute} 次/分钟）")


def _reset_for_tests() -> None:
    global _global_bucket
    _user_buckets.clear()
    _global_bucket = (0.0, 0.0)
