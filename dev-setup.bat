@echo off
chcp 65001 >nul
setlocal
cd /d %~dp0

echo [0/4] 前置检查（Docker Desktop 运行中 / Python / Node）...
where docker >nul 2>nul || (echo [X] 未安装 Docker Desktop，请先安装 & goto :fail)
docker info --format "{{.ServerVersion}}" >nul 2>nul || (echo [X] Docker Desktop 未运行，请先启动它 & goto :fail)
where python >nul 2>nul || (echo [X] 未安装 Python 3.13 & goto :fail)
where node >nul 2>nul || (echo [X] 未安装 Node 22+，请先安装 & goto :fail)

echo [1/4] 启动依赖容器（postgres / redis:6380 / jaeger / y-websocket）...
pushd docker
docker compose up -d postgres redis jaeger y-websocket
popd
if errorlevel 1 goto :fail

echo [2/4] 后端环境（venv + 依赖 + .env）...
pushd backend
if not exist .venv python -m venv .venv
.venv\Scripts\python -m pip install -q -r requirements.txt
if not exist .env (
    >.env  echo LLM_MODE=mock
    >>.env echo LLM_TIMEOUT_SECONDS=60
    >>.env echo LLM_TEMPERATURE_PARSE=0.1
    >>.env echo LLM_TEMPERATURE_FILL=0.6
    >>.env echo AI_DAILY_TOKEN_QUOTA=0
    >>.env echo AI_DAILY_TOKEN_QUOTA_PER_USER=0
    echo 已生成 backend\.env（mock 模式，零消耗）
)
popd

echo [3/4] 前端依赖（npm ci）...
pushd frontend
if not exist node_modules npm ci
if not exist node_modules goto :fail
popd

echo [4/4] 完成！日常启动：双击 dev-start.bat
echo 登录 demo / demo123
echo LLM 默认 mock 模式（演示模板稿，零消耗）
echo 要真实生成：编辑 backend\.env 填 Key 后改 LLM_MODE 为 real
pause
exit /b 0

:fail
echo.
echo 环境安装未完成，请按上方提示处理后重跑本脚本。
pause
exit /b 1
