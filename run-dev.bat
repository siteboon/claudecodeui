@echo off
echo Starting Claude Code UI in WSL...
echo.

REM Launch WSL and run the program from the WSL path
wsl -d Ubuntu -e bash -c "cd /mnt/d/Projects/GitHub/'Claude Code UI' && echo 'Installing/updating dependencies...' && npm install && npm run dev"

pause