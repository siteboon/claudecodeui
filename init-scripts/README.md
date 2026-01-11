# Initialization Scripts

This directory contains scripts that run automatically when the Claude Code UI Docker container starts. Use these scripts to customize your development environment, configure CLIs, and set up tools.

## How It Works

1. **Automatic Execution**: All executable `.sh` files in this directory are run in alphabetical order during container startup
2. **Before Server Start**: Scripts run before the main application server starts
3. **Non-Blocking**: If a script fails, the container continues to start (warnings are logged)

## Usage

### Creating Your Own Init Script

1. Create a new `.sh` file in this directory:
   ```bash
   touch init-scripts/my-custom-setup.sh
   ```

2. Make it executable:
   ```bash
   chmod +x init-scripts/my-custom-setup.sh
   ```

3. Add your initialization code:
   ```bash
   #!/bin/bash
   echo "Running my custom setup..."

   # Your code here
   git config --global user.name "My Name"
   git config --global user.email "me@example.com"
   ```

4. Restart the container to apply changes

### Naming Convention

Use number prefixes to control execution order:
- `00-first-script.sh` - Runs first
- `01-second-script.sh` - Runs second
- `99-last-script.sh` - Runs last

### Example Scripts Included

This directory includes several example scripts (disabled by default):

- **00-example-claude-config.sh** - Configure Claude Code CLI settings
- **01-example-cursor-config.sh** - Configure Cursor IDE settings
- **02-example-taskmaster-config.sh** - Configure Taskmaster CLI settings
- **03-example-git-config.sh** - Set up Git configuration
- **04-example-install-tools.sh** - Install additional tools

To use an example script:
1. Open the file and read the comments
2. Uncomment the sections you want to use
3. Modify the values to match your preferences
4. Make the script executable: `chmod +x init-scripts/00-example-claude-config.sh`

## Common Use Cases

### Configure Claude Code CLI

```bash
#!/bin/bash
mkdir -p /home/node/.claude
cat > /home/node/.claude/config.json <<EOF
{
  "model": "claude-3-5-sonnet-20241022",
  "maxTokens": 8096
}
EOF
```

### Configure Git

```bash
#!/bin/bash
git config --global user.name "Your Name"
git config --global user.email "your.email@example.com"
git config --global init.defaultBranch main
```

### Install npm Packages

```bash
#!/bin/bash
npm install -g typescript prettier eslint
```

### Set Environment Variables

```bash
#!/bin/bash
echo 'export MY_CUSTOM_VAR="value"' >> /home/node/.bashrc
```

### Clone Repositories

```bash
#!/bin/bash
if [ ! -d "/workspace/my-repo" ]; then
    git clone https://github.com/username/my-repo.git /workspace/my-repo
fi
```

## Best Practices

1. **Idempotency**: Make scripts safe to run multiple times
   - Check if files/directories exist before creating them
   - Use conditional logic to avoid duplicate operations

2. **Error Handling**: Add checks for critical operations
   ```bash
   if ! command -v git &> /dev/null; then
       echo "Git is not installed!"
       exit 1
   fi
   ```

3. **Logging**: Add informative echo statements
   ```bash
   echo "🔧 Configuring Claude Code..."
   echo "✅ Configuration complete"
   ```

4. **Permissions**: Remember the container runs as the `node` user
   - Scripts run with `node` user permissions
   - Avoid operations requiring root access
   - Use user-local paths: `/home/node/...`

## Environment Variables

These environment variables are available in your scripts:

- `NODE_ENV` - Usually "production"
- `PORT` - Application port (default: 3001)
- `DATABASE_PATH` - Database file path
- `CLAUDE_CLI_PATH` - Path to Claude CLI
- `HOME` - User home directory (/home/node)

## Mounted Volumes

Your scripts have access to:

- `/data` - Persistent data storage
- `/config` - Configuration files
- `/init-scripts` - This directory
- `/home/node/.claude` - Claude Code config
- `/home/node/.cursor` - Cursor config
- `/home/node/.taskmaster` - Taskmaster config
- Your project directories (as configured in docker-compose.yml)

## Troubleshooting

### Script Not Running

1. Check if the file is executable: `ls -la init-scripts/`
2. Run: `chmod +x init-scripts/your-script.sh`
3. Check container logs for errors: `docker logs claudecodeui`

### Script Fails

1. Check the container logs: `docker logs claudecodeui`
2. Test the script manually:
   ```bash
   docker exec -it claudecodeui bash
   bash /init-scripts/your-script.sh
   ```

### Permission Denied

- Scripts run as the `node` user (not root)
- Ensure paths are writable by the `node` user
- Use `/home/node/` paths instead of `/root/`

## Security Notes

- **Never commit sensitive data** (API keys, passwords) in init scripts
- Use environment variables or Docker secrets for sensitive configuration
- Review scripts from untrusted sources before running

## Examples by Tool

### Claude Code
```bash
#!/bin/bash
mkdir -p /home/node/.claude
echo '{"model": "claude-3-5-sonnet-20241022"}' > /home/node/.claude/config.json
```

### Taskmaster
```bash
#!/bin/bash
mkdir -p /home/node/.taskmaster
cat > /home/node/.taskmaster/config.yaml <<EOF
version: 1
settings:
  defaultModel: claude-3-5-sonnet-20241022
EOF
```

### Cursor
```bash
#!/bin/bash
mkdir -p /home/node/.cursor
echo '{"editor.fontSize": 14}' > /home/node/.cursor/settings.json
```

## Need Help?

- Check the example scripts in this directory
- View container logs: `docker logs claudecodeui`
- See the main README.md for Docker setup instructions
