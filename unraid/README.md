# Claude Code UI - Unraid Template

This directory contains the Unraid Community Applications template for Claude Code UI.

## Installation on Unraid

### Option 1: Via Community Applications (Recommended - Coming Soon)

Once this template is approved and added to Community Applications:

1. Open **Unraid WebUI**
2. Go to **Apps** tab
3. Search for **"claudecodeui"** or **"Claude Code UI"**
4. Click **Install**
5. Configure paths and settings (defaults work for most users)
6. Click **Apply**

### Option 2: Manual Template Installation

Until the template is available in Community Applications, you can install it manually:

1. **Open Unraid WebUI**
2. Go to **Docker** tab
3. Click **Add Container** at the bottom
4. Click **Template repositories** at the top
5. Add this repository URL:
   ```
   https://github.com/siteboon/claudecodeui
   ```
6. Or manually import the template:
   - Switch to **Advanced View**
   - Copy the contents of `claudecodeui.xml` from this directory
   - Paste into the template editor

### Option 3: Command Line Template URL

Add the template URL directly:

1. Go to **Docker** > **Add Container**
2. Set **Template URL** to:
   ```
   https://raw.githubusercontent.com/siteboon/claudecodeui/main/unraid/claudecodeui.xml
   ```
3. Click **Apply**

## Configuration

### Required Settings

| Setting | Default | Description |
|---------|---------|-------------|
| **WebUI Port** | `3002` | Port to access the web interface |
| **Application Data** | `/mnt/user/appdata/claudecodeui/data` | Database and user data |
| **Configuration** | `/mnt/user/appdata/claudecodeui/config` | Config files |
| **Claude CLI Data** | `/mnt/user/appdata/claudecodeui/claude` | Claude authentication |

### Project Directories

Configure at least one project directory where your code is located:

- **Projects Directory 1**: `/mnt/user/projects` (adjust to your location)
- **Projects Directory 2**: Optional additional directory
- **Projects Directory 3**: Optional additional directory

**Important**: Map your actual project locations. Common Unraid paths:
- `/mnt/user/projects`
- `/mnt/user/development`
- `/mnt/user/code`
- `/mnt/user/docker-projects`

### Advanced Settings

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3001` | Internal container port |
| `DATABASE_PATH` | `/data/auth.db` | Database file location |
| `CONTEXT_WINDOW` | `160000` | Claude context size |
| `CLAUDE_CLI_PATH` | `claude` | CLI executable path |
| `PUID` | `99` | User ID (nobody) |
| `PGID` | `100` | Group ID (users) |

## First-Time Setup

1. **Access WebUI**: Navigate to `http://[UNRAID-IP]:3002`
2. **Authenticate Claude CLI**: Follow the on-screen prompts to authenticate with your Anthropic account
3. **Configure Tools**: Enable the Claude Code tools you need in Settings
4. **Add Projects**: Your mounted project directories will be automatically discovered

## Usage

### Accessing the Application

- **WebUI**: `http://[UNRAID-IP]:3002`
- **From Mobile**: Access from any device on your network
- **PWA Support**: Add to home screen for app-like experience

### Managing the Container

From Unraid Docker tab:
- **Start/Stop**: Use the container controls
- **Logs**: Click the container icon > **Logs**
- **Console**: Click the container icon > **Console**
- **Update**: Click the container icon > **Force Update**

## Features

- **Self-Contained**: Claude CLI is pre-installed in the container
- **Persistent Data**: All data stored in Unraid appdata
- **Multi-Platform**: Supports both amd64 and arm64
- **Health Checks**: Built-in container health monitoring
- **Auto-Restart**: Configured to restart unless stopped

## Troubleshooting

### Container Won't Start

1. Check logs: Docker tab > Container icon > Logs
2. Verify port 3002 is not in use by another container
3. Check appdata permissions: `/mnt/user/appdata/claudecodeui`

### Cannot See Projects

1. Verify project directory paths are correct
2. Check that paths exist on your Unraid system
3. Ensure read/write permissions are set correctly
4. Container paths must match host paths for Claude Code to work properly

### Cannot Access Claude CLI

- The Claude CLI is pre-installed in the container
- On first run, you'll need to authenticate through the WebUI
- Authentication data is stored in `/mnt/user/appdata/claudecodeui/claude`

### Performance Issues

1. Ensure your Unraid server has adequate resources
2. Check Docker service is running properly
3. Monitor container resource usage in Unraid Dashboard

## Updating

The container will automatically pull updates when:
- You click **Force Update** in Unraid Docker tab
- Your Unraid is configured for automatic Docker updates

To manually update:
1. Go to **Docker** tab
2. Find **claudecodeui** container
3. Click the container icon
4. Select **Force Update**
5. Wait for download and restart

## Data Backup

Your data is stored in `/mnt/user/appdata/claudecodeui/`. To backup:

1. Stop the container
2. Backup the entire `/mnt/user/appdata/claudecodeui` directory
3. Restart the container

Or use Unraid's built-in backup solutions:
- **CA Backup/Restore Appdata** plugin
- **Unraid backup plugins**

## Support

- **Issues**: [GitHub Issues](https://github.com/siteboon/claudecodeui/issues)
- **Documentation**: [Main README](https://github.com/siteboon/claudecodeui#readme)
- **Unraid Forums**: [Community Applications subforum](https://forums.unraid.net/forum/88-docker-containers/)

## Community Applications Submission

This template is pending submission to Unraid Community Applications. Once approved, it will be available for one-click installation from the Apps tab.

## License

GNU General Public License v3.0 - See [LICENSE](../LICENSE) for details.

---

**Made with care for the Claude Code, Cursor, and Codex community.**
