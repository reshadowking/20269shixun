"""T20：AI 生成网关（进程内隔离 + 时间预算）。

要解决的问题（本机实测）：除两个路由外全部接口都是同步 `def`，由 Starlette 丢进 anyio 线程池
（默认上限 40）执行；生成调用一次 2.9–25.9s，会和画布增删改查抢同一批槽位。只加信号量没用——
等待槽位期间仍占着 anyio 槽位。**必须让路由 async 化 + 生成跑在专用池**，这才是隔离。

本模块提供三件事：
- `run_generation()`：把生成函数丢进专用 ThreadPoolExecutor（大小 = llm_max_concurrency），
  取不到槽位超过 `llm_queue_timeout_seconds` 就抛 `GatewayBusy`（路由转 503，不无限排队）；
- `GenerationDeadline`：整条链路的时间预算（覆盖"意图解析 + 摘要 + 填充 + 重试"全部阶段）；
- `_reset_for_tests()`：线程池与信号量都是模块级单例，测试之间必须能重置。

已知限制：单进程实现。若将来用 `--workers>1`，各 worker 各自计数（限流/熔断同理）。
"""
import asyncio
import functools
import logging
import time
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from typing import Any

from ..config import get_settings

logger = logging.getLogger(__name__)

_executor: ThreadPoolExecutor | None = None
_semaphore: asyncio.Semaphore | None = None


class GatewayBusy(RuntimeError):
    """取不到生成槽位（排队超时）——路由层转 503，属于"没开始干活"。"""


class GenerationDeadline:
    """整条生成链路的时间预算（单调时钟，不受系统时间跳变影响）。"""

    def __init__(self, seconds: float):
        self.total_seconds = max(0.0, float(seconds))
        self._end = time.monotonic() + self.total_seconds

    def remaining(self) -> float:
        return self._end - time.monotonic()

    def expired(self) -> bool:
        return self.remaining() <= 0.0


def _pool() -> ThreadPoolExecutor:
    global _executor
    if _executor is None:
        size = max(1, int(get_settings().llm_max_concurrency))
        _executor = ThreadPoolExecutor(max_workers=size, thread_name_prefix="ai-gen")
        logger.info("AI 生成专用线程池已创建：max_workers=%s", size)
    return _executor


def _slots() -> asyncio.Semaphore:
    global _semaphore
    if _semaphore is None:
        _semaphore = asyncio.Semaphore(max(1, int(get_settings().llm_max_concurrency)))
    return _semaphore


def _reset_for_tests() -> None:
    """清零池与信号量（配置在测试里被改过时必须调用，否则用例之间互相污染）。"""
    global _executor, _semaphore
    if _executor is not None:
        _executor.shutdown(wait=False)
    _executor = None
    _semaphore = None


async def run_generation(fn: Callable[..., Any], /, *args: Any, **kwargs: Any) -> Any:
    """在专用线程池里执行生成函数；排队超时抛 `GatewayBusy`。

    `fn` 必须是同步函数（生成链路本身是同步的）；本函数只负责"在哪跑、能跑几个"，
    不改变生成语义——因此 MCP 等既有调用方可以不经过它。
    """
    settings = get_settings()
    try:
        await asyncio.wait_for(_slots().acquire(), timeout=float(settings.llm_queue_timeout_seconds))
    except TimeoutError as exc:  # asyncio.wait_for 超时（3.11+ 与内置 TimeoutError 同义）
        raise GatewayBusy("生成任务排队超时") from exc
    try:
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(_pool(), functools.partial(fn, *args, **kwargs))
    finally:
        _slots().release()
