# Claude Code UI - Electron Desktop App

A cross-platform desktop application built with Electron for Claude Code UI.

## Current Status

✅ **Fully Functional Desktop Application**

- Cross-platform builds (Linux, Windows, macOS)
- Database path handling for packaged apps
- Custom branding and icons
- All distributions tested and working

## Prerequisites

- Node.js 20.x or higher
- npm 10.x or higher
- **Wine** (Linux only, for Windows cross-compilation)

### Installing Wine (Linux)

```bash
# Fedora/RHEL
sudo dnf install wine

# Ubuntu/Debian
sudo apt install wine

# Arch Linux
sudo pacman -S wine
```

## Quick Start

### Development

```bash
# Start web development server
npm run dev

# Start Electron in development mode
npm run electron-dev
```

### Building

```bash
# Build frontend (required before packaging)
npm run build

# Package Electron app for current platform
npm run electron

# Create distribution packages
npm run dist           # Current platform
npm run dist-linux     # Linux (AppImage + .deb)
npm run dist-win       # Windows (NSIS + portable)
npm run dist-mac       # macOS (DMG + ZIP)
npm run dist-all       # All platforms
```

### Using Makefile (Recommended)

```bash
# See all available commands
make help

# Build all Linux packages
make dist-linux-all

# Build Windows packages (requires Wine)
make dist-win

# Build everything for release
make release
```

## Architecture

- **Main Process** (`electron.js`) - Manages app lifecycle and windows
- **Web Server** - Express.js server on port 37429
- **Database** - SQLite with proper path handling for packaged apps

## Distribution Files

### Linux

- **AppImage**: `release/Claude Code UI-1.8.0.AppImage`
- **Debian**: `release/claude-code-ui_1.8.0_amd64.deb`
- **Flatpak**: `release/claude-code-ui-1.8.0.flatpak`

### Windows

- **Installer**: `release/Claude Code UI Setup 1.8.0.exe`
- **Portable**: `release/Claude Code UI 1.8.0.exe`

### macOS

- **DMG**: `release/Claude Code UI-1.8.0.dmg`
- **ZIP**: `release/Claude Code UI-1.8.0-mac.zip`

## Icons

Place your icons in the `public/` directory:

- `logo.png` - Main logo (534x534)
- `logo.ico` - Windows icon
- `logo.icns` - macOS icon
- `logo-512.png` - Flatpak icon (512x512)

## Troubleshooting

### Common Issues

1. **"Starting server from..." loop**
   - Fixed in current version

2. **Database access errors**
   - Database automatically uses `~/.config/claude-code-ui/` in packaged apps

3. **Cross-platform build failures**
   - Install Wine for Windows builds on Linux
   - macOS builds require macOS development environment

### Development Tips

- Always run `npm run build` before packaging
- Test with `npm run electron` before creating distributions
- Check Electron console for debug information

## Build Scripts Reference

```json
{
  "electron": "npm run build && electron .",
  "electron-dev": "concurrently --kill-others \"npm run client\" \"wait-on http://localhost:5173 && NODE_ENV=development electron .\"",
  "dist": "npm run build && electron-builder",
  "dist-linux": "npm run build && electron-builder --linux",
  "dist-win": "npm run build && electron-builder --win",
  "dist-mac": "npm run build && electron-builder --mac",
  "dist-all": "npm run build && electron-builder --linux --win --mac"
}
```

For detailed build configuration, see the `"build"` section in `package.json`.
