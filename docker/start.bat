@echo off
cd /d %~dp0
echo [1/2] Build and start services (first run ~5-10 min)...
docker compose up -d --build
if errorlevel 1 (
    echo Start failed! Check Docker Desktop is running and .env file exists.
    pause
    exit /b 1
)
echo [2/2] Waiting for services ready...
timeout /t 8 /nobreak >nul
echo.
echo ==========================================
echo   AI tool started
echo   Workspace: http://localhost:8080
echo   Login: demo / demo123
echo   Jaeger: http://localhost:16686
echo ==========================================
echo.
pause
