r"""生成链路日志（分析生成失败：阶段耗时 / 错误码 / 重试路径 / 修复动作）。

日志文件：<log_dir>/generate.log（默认 backend/logs/generate.log，滚动 5MB×3）
- "ai.gen" logger（INFO）：每次生成调用的阶段耗时、错误、修复动作
- 全量 WARNING：LLM 错误码（429/超时/401）与重试切模型日志同文件
用 grep "生成结束\|意图解析\|参数填充" 快速定位单次调用的完整链路。
"""
import logging
from logging.handlers import RotatingFileHandler
from pathlib import Path

GEN_LOGGER_NAME = "ai.gen"


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
