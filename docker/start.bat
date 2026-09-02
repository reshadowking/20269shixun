@echo off
rem AI 原生设计工具 - 一键启动（Windows）
rem 首次使用：确保本目录有 .env（从 .env.template 复制并填写 LLM_API_KEY）
cd /d %~dp0

echo [1/2] 构建并启动全部服务（首次约 5-10 分钟）...
docker compose up -d --build
if errorlevel 1 (
    echo 启动失败，请确认 Docker Desktop 已打开，且 .env 已配置
    pause
    exit /b 1
)

echo [2/2] 等待服务就绪...
timeout /t 8 /nobreak >nul

echo.
echo ==========================================
echo   AI 原生设计工具已启动：
echo   工作台： http://localhost:8080
echo   登录账号：demo / demo123
echo   链路追踪：http://localhost:16686
echo ==========================================
echo.
pause
