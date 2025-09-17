# Claude Code UI Build System
# Makefile for cross-platform builds

# Extract version from package.json
VERSION := $(shell grep '"version"' package.json | cut -d'"' -f4)

.PHONY: help clean build dist-linux-deb dist-linux-appimage dist-linux-flatpak dist-linux-all dist-win dist-mac dist-all dist electron electron-dev flatpak dev test install setup

# Default target
help:
	@echo "Claude Code UI Build System"
	@echo "============================="
	@echo ""
	@echo "Available targets:"
	@echo "  install      - Install NPM packages"
	@echo "  build        - Build frontend only"
	@echo "  dev          - Start development servers"
	@echo "  test         - Run tests (if available)"
	@echo "  clean        - Clean build artifacts"
	@echo ""
	@echo "Electron Builds:"
	@echo "  electron     - Build frontend and run Electron"
	@echo "  electron-dev - Start Electron in development mode"
	@echo "  dist         - Build generic Electron package"
	@echo "  dist-win     - Build Windows packages (NSIS, portable)"
	@echo "  dist-mac     - Build macOS packages (DMG, ZIP)"
	@echo "  dist-all     - Build all platforms"
	@echo ""
	@echo "Linux Builds:"
	@echo "  dist-linux-deb       - Build .deb packages only"
	@echo "  dist-linux-appimage  - Build AppImage packages only"
	@echo "  dist-linux-flatpak   - Build Flatpak package only"
	@echo "  dist-linux-all       - Build all Linux packages"
	@echo "  flatpak-test         - Build and test Flatpak locally"
	@echo ""
	@echo "Release:"
	@echo "  release      - Build all packages for release"

# Install NPM packages
install:
	@echo "📦 Installing NPM packages"
	npm install

# Build frontend
build:
	@echo "🏗️  Building frontend..."
	npm run build

# Electron (build and run)
electron: build
	@echo "⚡ Running Electron application..."
	npm run electron

# Electron development mode
electron-dev:
	@echo "⚡ Starting Electron in development mode..."
	npm run electron-dev

# Generic dist build
dist: build
	@echo "📦 Building Electron package..."
	npm run dist
	@echo "✅ Electron package build complete"

# Development
dev:
	@echo "🚀 Starting development servers..."
	npm run dev

# Testing
test:
	@echo "🧪 Running tests..."
	@if [ -f "package.json" ] && grep -q '"test"' package.json; then \
		npm test; \
	else \
		echo "No tests configured"; \
	fi

# Clean build artifacts
clean:
	@echo "🧹 Cleaning build artifacts..."
	rm -rf dist/
	rm -rf release/
	rm -rf build-dir/
	rm -rf repo*/
	rm -rf .flatpak-builder/
	rm -f *.flatpak
	@echo "✅ Clean complete"

# Linux .deb packages
dist-linux-deb: build
	@echo "📦 Building Linux .deb packages..."
	npm run build && npx electron-builder --linux deb
	@echo "✅ Linux .deb builds complete"

# Linux AppImage packages
dist-linux-appimage: build
	@echo "📦 Building Linux AppImage packages..."
	npm run build && npx electron-builder --linux AppImage
	@echo "✅ Linux AppImage builds complete"

# Linux Flatpak package
dist-linux-flatpak: build
	@echo "📦 Building Flatpak package (version $(VERSION))..."
	@if command -v flatpak-builder >/dev/null 2>&1; then \
		mkdir -p release; \
		echo "Building Flatpak repository..."; \
		flatpak-builder --repo=repo build-dir flatpak/com.claude_code_ui.app.yaml --force-clean --install-deps-from=flathub; \
		echo "Creating distributable bundle..."; \
		flatpak build-bundle repo release/claude-code-ui-$(VERSION).flatpak com.claude_code_ui.app; \
		echo "✅ Flatpak build complete"; \
		echo "📁 Files created:"; \
		echo "   - repo/ (repository)"; \
		echo "   - release/claude-code-ui-$(VERSION).flatpak (bundle)"; \
	else \
		echo "❌ flatpak-builder not found. Install flatpak development tools:"; \
		echo "   Fedora: sudo dnf install flatpak-builder"; \
		echo "   Ubuntu: sudo apt install flatpak-builder"; \
		echo "   Arch:   sudo pacman -S flatpak-builder"; \
		exit 1; \
	fi

# All Linux builds
dist-linux-all: dist-linux-deb dist-linux-appimage dist-linux-flatpak
	@echo "✅ All Linux builds complete"

# Windows builds (requires Wine)
dist-win: build
	@echo "🪟 Building Windows packages..."
	@if command -v wine >/dev/null 2>&1; then \
		npm run dist-win; \
		echo "✅ Windows builds complete"; \
	else \
		echo "❌ Wine not found. Install wine to build Windows packages."; \
		echo "   Fedora: sudo dnf install wine"; \
		echo "   Ubuntu: sudo apt install wine"; \
		exit 1; \
	fi

# macOS builds (macOS only)
dist-mac: build
	@echo "🍎 Building macOS packages..."
	@if [ "$$(uname)" = "Darwin" ]; then \
		npm run dist-mac; \
		echo "✅ macOS builds complete"; \
	else \
		echo "❌ macOS builds can only be created on macOS"; \
		exit 1; \
	fi

# All platform builds
dist-all: dist-linux-all
	@echo "🌐 Building all platform packages..."
	@if command -v wine >/dev/null 2>&1; then \
		echo "Building Windows packages..."; \
		npm run dist-win; \
	else \
		echo "⚠️  Skipping Windows build (Wine not available)"; \
	fi
	@if [ "$$(uname)" = "Darwin" ]; then \
		echo "Building macOS packages..."; \
		npm run dist-mac; \
	else \
		echo "⚠️  Skipping macOS build (not on macOS)"; \
	fi
	@echo "✅ All platform builds complete"

# Flatpak build (alias for dist-linux-flatpak)
flatpak: dist-linux-flatpak

# Flatpak test (build and install locally)
flatpak-test: dist-linux-flatpak
	@echo "🧪 Testing Flatpak locally..."
	@echo "Installing Flatpak bundle locally..."; \
	flatpak install --user --noninteractive release/claude-code-ui-$(VERSION).flatpak || true; \
	echo "✅ Flatpak installed. Run with: flatpak run com.claude_code_ui.app"

# Release build (all packages)
release: clean
	@echo "🚀 Building release packages..."
	@echo "This will build all distribution packages..."
	@echo "Building version: $(VERSION)"

	# Build frontend first
	$(MAKE) build

	# Build all packages
	$(MAKE) dist-linux-all
	@if command -v wine >/dev/null 2>&1; then \
		echo "Building Windows packages..."; \
		npm run dist-win; \
	else \
		echo "⚠️  Skipping Windows build (Wine not available)"; \
	fi

	@echo ""
	@echo "🎉 Release build complete!"
	@echo "📁 Release artifacts in release/ directory:"
	@ls -la release/ 2>/dev/null || echo "   (No release directory created)"

# Install dependencies (removed duplicate - already defined above)

# Development setup
setup: install
	@echo "⚙️  Setting up development environment..."
	@if command -v flatpak >/dev/null 2>&1; then \
		echo "Setting up Flatpak development..."; \
		flatpak remote-add --if-not-exists --user flathub https://flathub.org/repo/flathub.flatpakrepo; \
		flatpak install --user flathub org.freedesktop.Platform//23.08 org.freedesktop.Sdk//23.08 org.freedesktop.Sdk.Extension.node20//23.08 || true; \
	fi
	@echo "✅ Development environment ready"
	@echo ""
	@echo "🚀 Quick start:"
	@echo "   make dev    - Start development servers"
	@echo "   make build  - Build frontend"
	@echo "   make help   - Show all available commands"
