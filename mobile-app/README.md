# Claude Code Mobile

A Flutter-based SSH client for Claude Code UI. Connect to your Claude Code server from your iOS or Android device and use the Claude CLI on the go.

## Features

- **SSH Connection**: Connect to your Claude Code UI server via SSH
- **Terminal Emulator**: Full-featured terminal with xterm.dart
- **Virtual Keyboard**: Special keys (Ctrl, Esc, Arrow keys) for mobile convenience
- **Saved Connections**: Store multiple server configurations
- **Secure Storage**: Passwords stored in device secure storage
- **Dark Theme**: Optimized for terminal use

## Prerequisites

### Server Setup

1. Make sure your Claude Code UI server has SSH enabled (it's enabled by default)
2. The SSH server runs on port **2222** by default
3. Use the same username/password as your Claude Code UI login

### Building the App

1. Install [Flutter](https://flutter.dev/docs/get-started/install) (version 3.0+)
2. Clone this repository
3. Run the following commands:

```bash
cd mobile-app
flutter pub get
```

### iOS

```bash
cd ios
pod install
cd ..
flutter build ios
```

### Android

```bash
flutter build apk
# or for release
flutter build apk --release
```

## Usage

1. **Add a Server**: Tap "Add Server" and enter your connection details:
   - **Name**: A friendly name for the connection
   - **Host**: Your server's IP address or domain
   - **Port**: SSH port (default: 2222)
   - **Username**: Your Claude Code UI username

2. **Connect**: Tap on a saved server, enter your password, and you'll be connected to the Claude Code CLI

3. **Use the Terminal**:
   - Type commands using your device keyboard
   - Use the virtual keyboard for special keys (Ctrl+C, Esc, arrows, etc.)
   - Long-press to paste from clipboard

## Configuration

### SSH Server (Claude Code UI)

The SSH server can be configured in your `.env` file:

```env
# Enable/disable SSH server
ENABLE_SSH=true

# SSH port (default: 2222)
SSH_PORT=2222
```

### Connecting Remotely

To connect from outside your local network:

1. **Port Forwarding**: Forward port 2222 on your router to your server
2. **Use ngrok**: Set up an ngrok TCP tunnel:
   ```bash
   ngrok tcp 2222
   ```
3. **VPN**: Connect to your home network via VPN

## Security Notes

- SSH connections are encrypted
- Passwords are stored in device secure storage (Keychain on iOS, Keystore on Android)
- The SSH server uses the same authentication as the Web UI
- Consider using a strong password

## Troubleshooting

### Connection Failed

1. Verify the server is running: `curl http://your-server:3001/health`
2. Check SSH is enabled in your server config
3. Verify the port is accessible: `nc -zv your-server 2222`
4. Check firewall settings

### Terminal Issues

1. If the terminal appears blank, try resizing your device
2. Use the virtual keyboard for special keys that your device keyboard doesn't have

## License

This mobile app is part of Claude Code UI and is licensed under GPL v3.

## Acknowledgments

- [dartssh2](https://github.com/TerminalStudio/dartssh2) - SSH client library
- [xterm.dart](https://github.com/TerminalStudio/xterm.dart) - Terminal emulator
