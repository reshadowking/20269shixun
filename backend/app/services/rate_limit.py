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
"""
登录限流的桶：key = `"{ip}|{username}"`。与生成限流**分开计数** —— 登录失败不该吃掉生成
额度，反之亦然。

为什么 key 里带 ip：只按用户名限流的话，任何人都能靠刷错口令把某个账号"锁掉一分钟"；
带上 ip 之后，"同一个人从同一处反复猜"才被拦。

键空间是**攻击者可控**的（用户名随便填），所以下面做了一个粗暴但够用的上限，
避免被人塞满内存（进程内实现的已知限制，与生成限流同一档）。
"""
_login_buckets: dict[str, tuple[float, float]] = {}
_LOGIN_BUCKETS_MAX = 10000
"""
注册限流的桶：key = ip。与登录的桶分开——**每次注册调用都扣**（批量建号本身就是攻击面，
只拦失败没有意义），而登录只对失败计费。键空间同样受攻击者影响（换个 IP 就换桶），
所以沿用同一个粗暴上限。
"""
_register_buckets: dict[str, tuple[float, float]] = {}


def _take(state: tuple[float, float], capacity: int, now: float, cost: int) -> tuple[bool, tuple[float, float]]:
    tokens, last = state
    if capacity <= 0:
        # 2026-09-17 修：`config.py` 明确写着「0 表示不限制」（与旁边的日配额同一约定），
        # 但旧实现把 0 当成"容量为 0 的桶"→ 任何 cost>=1 的请求都被拒，
        # 实测 `ai_rate_limit_per_minute=0` 会把生成**全部**拒掉（"限制 0 次/分钟"）。
        # 这里按文档语义放行（容量 0/负 = 该维不限流），与 ai_daily_token_quota 的 0 一致。
        return True, (0.0, now)
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
    _login_buckets.clear()
    _register_buckets.clear()
    _global_bucket = (0.0, 0.0)


def check_login(key: str) -> None:
    """登录**之前**检查额度；用尽则抛 `RateLimited`（调用方转 429）。

    只检查、不扣减：额度由**失败**累积（见 `note_login_failure`）。这样正常用户（口令正确）
    永远不会把自己的额度打满，而暴力破解者每猜错一次就少一次机会。
    """
    capacity = get_settings().login_rate_limit_per_minute
    if capacity <= 0:
        return  # 0 = 不限制（与 ai_rate_limit_per_minute 同一约定）
    tokens, last = _login_buckets.get(key, (0.0, 0.0))
    now = time.monotonic()
    refreshed = min(float(capacity), tokens + (now - last) * capacity / 60.0) if last else float(capacity)
    if refreshed < 1:
        raise RateLimited("登录尝试过于频繁，请稍后再试")


def note_login_failure(key: str) -> None:
    """记一次凭证失败。成功后调用 `clear_login_failures` 把该 key 的计数清掉。"""
    capacity = get_settings().login_rate_limit_per_minute
    if capacity <= 0:
        return
    if len(_login_buckets) >= _LOGIN_BUCKETS_MAX and key not in _login_buckets:
        _login_buckets.clear()  # 粗暴但够用：宁可放行一批，也不无限涨
    tokens, last = _login_buckets.get(key, (0.0, 0.0))
    now = time.monotonic()
    refreshed = min(float(capacity), tokens + (now - last) * capacity / 60.0) if last else float(capacity)
    _login_buckets[key] = (max(0.0, refreshed - 1.0), now)


def clear_login_failures(key: str) -> None:
    """凭证正确时清空该 key —— 否则用户手滑几次之后，成功登录过的账号还会被自己挡在门外。"""
    _login_buckets.pop(key, None)


def check_register(key: str) -> None:
    """注册**之前**检查并按次扣减（`key` = 客户端 IP）；用尽抛 `RateLimited`（调用方转 429）。

    与 `check_login` 的差别：注册不区分成功/失败，每次都扣 —— 拦的是"批量建号"本身。
    `register_rate_limit_per_minute = 0` 表示不限制（与其它限流同一约定）。
    """
    capacity = get_settings().register_rate_limit_per_minute
    if capacity <= 0:
        return
    if len(_register_buckets) >= _LOGIN_BUCKETS_MAX and key not in _register_buckets:
        _register_buckets.clear()  # 与登录桶同一套粗暴上限（IP 是攻击者可变的）
    ok, bucket = _take(_register_buckets.get(key, (0.0, 0.0)), capacity, time.monotonic(), 1)
    _register_buckets[key] = bucket
    if not ok:
        raise RateLimited(f"注册过于频繁，请稍后再试（限制 {capacity} 次/分钟）")
