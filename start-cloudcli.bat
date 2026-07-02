@echo off
REM Launch CloudCLI standalone (server on :3001 + client on :5173).
REM Double-click this file, or run it from a terminal. Close the window to stop.

cd /d "%~dp0"

REM Free port 3001 if a previous instance is still listening.
for /f "tokens=5" %%P in ('netstat -ano ^| findstr /r /c:":3001 .*LISTENING"') do (
    echo Stopping previous server on :3001 (PID %%P)...
    taskkill /F /PID %%P >nul 2>&1
)

echo Starting CloudCLI...
echo   Server: http://localhost:3001
echo   App UI: http://localhost:5173
echo.

call npm run dev

echo.
echo Server stopped.
pause
