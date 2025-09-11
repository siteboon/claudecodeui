# Building Claude Code UI as Flatpak

This document provides comprehensive instructions for building Claude Code UI as a Flatpak application using the integrated Makefile build system.

## Overview

The Flatpak build system creates a fully sandboxed desktop application with:

- ✅ Complete Electron runtime (~860MB)
- ✅ Bundled Node.js 20.x runtime
- ✅ All native dependencies (SQLite, bcrypt, node-pty)
- ✅ Hidden menu bar by default (accessible via Alt key)
- ✅ Proper desktop integration with icon and .desktop file
- ✅ Automatic version detection from package.json

## Prerequisites

### Install Flatpak Build Tools

```bash
# Fedora/RHEL
sudo dnf install flatpak-builder

# Ubuntu/Debian
sudo apt install flatpak-builder

# Arch Linux
sudo pacman -S flatpak-builder
```

### Setup Development Environment

The Makefile provides an automated setup command:

```bash
make setup
```

This will:

- Install npm dependencies
- Add Flathub repository if not exists
- Install required Flatpak runtimes:
  - org.freedesktop.Platform//23.08
  - org.freedesktop.Sdk//23.08
  - org.freedesktop.Sdk.Extension.node20//23.08

### Manual Runtime Installation

If you prefer manual setup:

```bash
flatpak remote-add --if-not-exists --user flathub https://flathub.org/repo/flathub.flatpakrepo
flatpak install --user flathub org.freedesktop.Platform//23.08 org.freedesktop.Sdk//23.08 org.freedesktop.Sdk.Extension.node20//23.08
```

## Quick Build (Recommended)

### Build Flatpak Package

```bash
make dist-linux-flatpak
```

### Build and Test Locally

```bash
make flatpak-test
```

This will build the Flatpak and install it locally for testing.

### Build All Linux Packages

```bash
make dist-linux-all
```

Builds .deb, AppImage, and Flatpak packages.

## Makefile Commands

The Makefile provides several Flatpak-related targets:

| Command                   | Description                                       |
| ------------------------- | ------------------------------------------------- |
| `make dist-linux-flatpak` | Build Flatpak package only                        |
| `make flatpak`            | Alias for `dist-linux-flatpak`                    |
| `make flatpak-test`       | Build and install Flatpak locally                 |
| `make dist-linux-all`     | Build all Linux packages (deb, AppImage, Flatpak) |
| `make clean`              | Clean all build artifacts including Flatpak files |
| `make setup`              | Setup development environment with dependencies   |

## Build Process Details

The Makefile automatically:

1. **Extracts version** from `package.json`
2. **Builds frontend** with `npm run build`
3. **Creates repository** using `flatpak-builder`
4. **Generates bundle** with version-specific filename
5. **Validates dependencies** and provides helpful error messages

### Build Command Breakdown

```bash
# The Makefile runs these commands:
mkdir -p release
flatpak-builder --repo=repo build-dir flatpak/com.claude_code_ui.app.yaml --force-clean --install-deps-from=flathub
flatpak build-bundle repo release/claude-code-ui-$(VERSION).flatpak com.claude_code_ui.app
```

## Build Artifacts

After running `make dist-linux-flatpak`, you'll have:

- **`repo/`** - Complete Flatpak repository
- **`release/claude-code-ui-$(VERSION).flatpak`** - Distributable bundle (~310MB)
- **`build-dir/`** - Build directory (can be cleaned)

Version is automatically extracted from package.json, so the bundle will be named like `claude-code-ui-1.8.0.flatpak`.

## Testing and Installation

### Local Testing

```bash
# Build and install locally
make flatpak-test

# Run the application
flatpak run com.claude_code_ui.app
```

### Manual Installation from Bundle

```bash
# Install from generated bundle
flatpak install --user release/claude-code-ui-$(VERSION).flatpak

# Run the application
flatpak run com.claude_code_ui.app
```

### Manual Installation from Repository

```bash
# Add local repository
flatpak --user remote-add --no-gpg-verify claude-code-ui-repo repo

# Install from repository
flatpak --user install claude-code-ui-repo com.claude_code_ui.app
```

## Cleaning Build Artifacts

```bash
make clean
```

This removes:

- `dist/` directory
- `release/` directory
- `build-dir/` directory
- `repo*/` directories
- `.flatpak-builder/` directory
- `*.flatpak` files

## Error Handling

The Makefile includes automatic dependency checking:

### Flatpak Builder Not Found

```
❌ flatpak-builder not found. Install flatpak development tools:
   Fedora: sudo dnf install flatpak-builder
   Ubuntu: sudo apt install flatpak-builder
   Arch:   sudo pacman -S flatpak-builder
```

### Build Success Messages

```
📦 Building Flatpak package (version 1.8.0)...
Building Flatpak repository...
Creating distributable bundle...
✅ Flatpak build complete
📁 Files created:
   - repo/ (repository)
   - release/claude-code-ui-1.8.0.flatpak (bundle)
```

## Integration with Other Builds

### Release Build

```bash
make release
```

Builds all packages including Flatpak for complete release.

### Linux-Only Build

```bash
make dist-linux-all
```

Builds all Linux packages: .deb, AppImage, and Flatpak.

## Troubleshooting

### Common Issues

#### 1. Build Dependencies Missing

**Error**: `npm: command not found` during build
**Solution**: Run `make setup` to install all dependencies

#### 2. Runtime Not Available

**Error**: Runtime not found during flatpak-builder
**Solution**: Run `make setup` or manually install runtimes

#### 3. Permission Issues

**Error**: Cannot write to directories
**Solution**: Ensure you have write permissions to the project directory

#### 4. Version Detection Issues

**Error**: Cannot extract version from package.json
**Solution**: Ensure package.json exists and has a valid "version" field

### Build Environment Requirements

The build process requires:

- **Node.js**: For frontend build (`npm run build`)
- **Flatpak Builder**: For creating the Flatpak package
- **Git**: For source management (if building from git)
- **Internet**: For downloading dependencies from Flathub

## Distribution

The final versioned bundle (e.g., `claude-code-ui-1.8.0.flatpak`) can be:

- Distributed directly to users
- Uploaded to GitHub releases
- Published to Flathub (requires additional submission process)

### User Installation Instructions

```bash
# Download the .flatpak file, then:
flatpak install claude-code-ui-1.8.0.flatpak

# Or install with --user flag for user-only installation:
flatpak install --user claude-code-ui-1.8.0.flatpak

# Run the application
flatpak run com.claude_code_ui.app
```

## Development Workflow

1. **Setup**: `make setup` (one-time)
2. **Develop**: `make dev` (development servers)
3. **Test Build**: `make build` (frontend only)
4. **Test Flatpak**: `make flatpak-test` (build and install locally)
5. **Release**: `make release` (all packages)

## Files Structure

The Flatpak build uses these files:

- **`flatpak/com.claude_code_ui.app.yaml`** - Flatpak manifest
- **`flatpak/claude-code-ui-wrapper`** - Runtime wrapper script (if present)
- **`flatpak/claude-code-ui.desktop`** - Desktop integration file (if present)
- **`Makefile`** - Build system with Flatpak targets
- **`package.json`** - Version source and npm dependencies

## Performance Notes

- **Build Time**: ~3-5 minutes (depending on system and network)
- **Bundle Size**: ~310MB (includes full Electron runtime)
- **Runtime Memory**: ~200-400MB (typical Electron application)
- **First Build**: Longer due to runtime downloads
- **Subsequent Builds**: Faster due to cached runtimes
