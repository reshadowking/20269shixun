#!/usr/bin/env python3
"""打包交付 zip（给别人部署运行）。

排除：.env（含 API Key）、node_modules、.venv、.git、构建产物、测试产物、编辑器文件。
保留：全部源码 + Dockerfile + compose + 一键脚本 + 文档。
用法：python scripts/package_delivery.py
"""
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "AI原生设计工具-交付包.zip"

# 排除的目录/文件名（前缀匹配，相对项目根）
EXCLUDE_DIRS = {
    ".git", "node_modules", ".venv", "dist", "__pycache__", ".pytest_cache",
    ".ruff_cache", "test-results", "playwright-report", ".zcode", "coverage",
    "smoke_test", ".agents",
}
EXCLUDE_FILES = {
    ".env", ".env.local", "*.pyc", "*.log", "*.zip", ".DS_Store", "thumbs.db",
    "debug-*.mjs", "check_page.mjs", "*.db", "*.sqlite3", "report.json",
}
# 显式排除的单个文件（含 Key 的 .env 全部排除）
EXCLUDE_PATHS = {"docker/.env", "backend/.env"}

# 排除的前缀目录（相对项目根）
EXCLUDE_PREFIX = {
    "frontend/test-results", "frontend/playwright-report", "frontend/dist",
    # 前端保存的 LLM 配置（含 API Key）与生成日志、测试数据库，一律不进交付包
    "backend/data", "backend/logs",
}


def should_exclude(rel: str, is_dir: bool) -> bool:
    parts = rel.replace("\\", "/").split("/")
    name = parts[-1]
    if any(p in EXCLUDE_DIRS for p in parts):
        return True
    if rel in EXCLUDE_PATHS:
        return True
    if any(rel.startswith(p) for p in EXCLUDE_PREFIX):
        return True
    if not is_dir:
        for pattern in EXCLUDE_FILES:
            if pattern.startswith("*"):
                if name.endswith(pattern[1:]):
                    return True
            elif name == pattern:
                return True
    return False


def main() -> int:
    if OUT.exists():
        OUT.unlink()
    count = 0
    with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED) as zf:
        for path in sorted(ROOT.rglob("*")):
            if path.is_dir():
                continue
            rel = path.relative_to(ROOT).as_posix()
            if should_exclude(rel, False):
                continue
            zf.write(path, f"AI原生设计工具/{rel}")
            count += 1
    size_mb = OUT.stat().st_size / 1024 / 1024
    print(f"打包完成：{OUT.name}（{count} 个文件，{size_mb:.1f} MB）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
