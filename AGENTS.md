# Repository guidance

## Backend code

For every task that creates, modifies, refactors, or reviews backend code under `server/`, load and follow `$backend-module-standards` from `.agents/skills/backend-module-standards/SKILL.md`. Apply it only to backend code; do not impose those architecture rules on the frontend.

## Service Operations & Process Management

This project is managed and monitored via **PM2**:
- Application name: `cloudcli-ui`
- Restart command: `pm2 restart cloudcli-ui`
- Logs command: `pm2 logs cloudcli-ui`
- Status command: `pm2 status`
- Default service port: `3001` (`http://localhost:3001`)

Always use PM2 commands when restarting or inspecting the server process, rather than running ad-hoc background node processes.
