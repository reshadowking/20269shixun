@echo off
chcp 65001 >nul
setlocal
cd /d %~dp0

if not exist backend\.venv (
    echo [X] 还没装环境：请先双击 dev-setup.bat
    pause
    exit /b 1
)

echo [1/3] 依赖容器（已启动则秒过）...
pushd docker
docker compose up -d postgres redis jaeger y-websocket
popd

echo [2/3] 后端 :8000（--reload 热重载，独立窗口）...
start "backend :8000" cmd /k "cd /d %~dp0backend && .venv\Scripts\python -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload"

echo [3/3] 前端 :5173（vite，独立窗口）...
start "frontend :5173" cmd /k "cd /d %~dp0frontend && npm run dev"

echo 等待服务就绪...
timeout /t 8 /nobreak >nul
start "" http://localhost:5173
echo 已启动：工作台 http://localhost:5173
echo 登录 demo / demo123
echo 后端日志在 backend 窗口、前端在 frontend 窗口，关窗即停
echo LLM 模式看 backend\.env（默认 mock 零消耗）
pause
