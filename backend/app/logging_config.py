r"""生成链路日志（分析生成失败：阶段耗时 / 错误码 / 重试路径 / 修复动作）。

日志文件：<log_dir>/generate.log（默认 backend/logs/generate.log，滚动 5MB×3）
- "ai.gen" logger（INFO）：每次生成调用的阶段耗时、错误、修复动作
- 全量 WARNING：LLM 错误码（429/超时/401）与重试切模型日志同文件
用 grep "生成结束\|意图解析\|参数填充" 快速定位单次调用的完整链路。

另有 <log_dir>/capability_gap_detail.log（T52，滚动 10MB×5）：能力缺口的**原文**专用日志——
DB（ai_capability_gaps）里的 detail/node_id 经 _sanitize_detail 净化防泄漏，排查用的完整原文
只落这里。独立于主日志的理由：主日志 5MB×4 会把低频高价值的原文滚掉，而 gap 量级小，
50MB 预算按"新值"计足够长期保留。
"""
import logging
from logging.handlers import RotatingFileHandler
from pathlib import Path

GEN_LOGGER_NAME = "ai.gen"
GAP_DETAIL_LOGGER_NAME = "ai.gap_detail"


def init_generate_logging(log_dir: str) -> None:
    log_path = Path(log_dir) / "generate.log"
    log_path.parent.mkdir(parents=True, exist_ok=True)
    fmt = logging.Formatter("%(asctime)s %(levelname)s [%(name)s] %(message)s")

    gen = logging.getLogger(GEN_LOGGER_NAME)
    gen.setLevel(logging.INFO)  # logger 级别必须显式设置（默认继承 root 的 WARNING，会拦掉 INFO）
    if not any(isinstance(h, RotatingFileHandler) for h in gen.handlers):
        handler = RotatingFileHandler(log_path, maxBytes=5 * 1024 * 1024, backupCount=3, encoding="utf-8")
        handler.setFormatter(fmt)
        handler.setLevel(logging.INFO)
        gen.addHandler(handler)

    root = logging.getLogger()
    if not any(getattr(h, "baseFilename", "") == str(log_path) for h in root.handlers):
        warn_handler = RotatingFileHandler(log_path, maxBytes=5 * 1024 * 1024, backupCount=3, encoding="utf-8")
        warn_handler.setFormatter(fmt)
        warn_handler.setLevel(logging.WARNING)
        root.addHandler(warn_handler)


def init_gap_detail_logging(log_dir: str) -> None:
    """T52：缺口原文专用日志（capability_gap_detail.log，10MB×5）。

    - propagate=False：原文不进主日志（主日志滚得快，且原文与流程日志受众不同）；
    - 幂等：重复调用（测试/多次 lifespan）不重复挂 handler。
    由 ai_ledger.record_capability_gaps 写入，DB 落库前先写这里——DB 挂了原文也还在。
    """
    log_path = Path(log_dir) / "capability_gap_detail.log"
    log_path.parent.mkdir(parents=True, exist_ok=True)

    gap_logger = logging.getLogger(GAP_DETAIL_LOGGER_NAME)
    gap_logger.setLevel(logging.INFO)
    gap_logger.propagate = False
    if not any(
        isinstance(h, RotatingFileHandler) and getattr(h, "baseFilename", "") == str(log_path)
        for h in gap_logger.handlers
    ):
        handler = RotatingFileHandler(log_path, maxBytes=10 * 1024 * 1024, backupCount=5, encoding="utf-8")
        handler.setFormatter(logging.Formatter("%(asctime)s %(message)s"))
        handler.setLevel(logging.INFO)
        gap_logger.addHandler(handler)
