#!/usr/bin/env bash
# AI 原生设计工具 - 一键启动（Linux/macOS）
# 首次使用：确保本目录有 .env（从 .env.template 复制并填写 LLM_API_KEY）
set -e
cd "$(dirname "$0")"

echo "[1/2] 构建并启动全部服务（首次约 5-10 分钟）..."
docker compose up -d --build

echo "[2/2] 等待服务就绪..."
sleep 8

echo ""
echo "=========================================="
echo "  AI 原生设计工具已启动："
echo "  工作台： http://localhost:8080"
echo "  登录账号：demo / demo123"
echo "  链路追踪：http://localhost:16686"
echo "=========================================="
