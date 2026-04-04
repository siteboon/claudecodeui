#!/usr/bin/env bash
# =============================================================================
# 打包脚本 — 构建可分发的 cloudcli-deploy.tar.gz
# 在开发机上运行:  ./deploy/pack.sh
# =============================================================================

set -euo pipefail

BLUE='\033[0;34m'
GREEN='\033[0;32m'
NC='\033[0m'
Info() { echo -e "${BLUE}[INFO]${NC}  $*"; }
Ok()   { echo -e "${GREEN}[OK]${NC}    $*"; }

PROJ_ROOT=$(cd "$(dirname "$0")/.." && pwd)
BUILD_DIR=$(mktemp -d)
STAGE="${BUILD_DIR}/cloudcli-deploy"
ARCHIVE_NAME="cloudcli-deploy.tar.gz"

trap 'rm -rf "$BUILD_DIR"' EXIT

cd "$PROJ_ROOT"

# 1. 构建前端
Info "构建前端..."
npm run build

# 2. 准备应用源码包 (只包含运行时需要的文件)
Info "准备应用源码..."
mkdir -p "${STAGE}"

# 创建内部压缩包 cloudcli.tar.gz (install.sh 需要它)
INNER_DIR=$(mktemp -d)
INNER="${INNER_DIR}/cloudcli"
mkdir -p "$INNER"

# 复制运行时文件
cp -r server/    "$INNER/server/"
cp -r shared/    "$INNER/shared/"
cp -r dist/      "$INNER/dist/"
cp -r scripts/   "$INNER/scripts/"
cp -r public/    "$INNER/public/"
cp    package.json package-lock.json "$INNER/"

# 移除开发时才需要的文件
find "$INNER" -name "*.map" -delete 2>/dev/null || true

Info "压缩应用包..."
tar czf "${STAGE}/cloudcli.tar.gz" -C "$INNER_DIR" cloudcli
rm -rf "$INNER_DIR"

# 3. 复制部署脚本
cp deploy/install.sh   "${STAGE}/install.sh"
cp deploy/uninstall.sh "${STAGE}/uninstall.sh"
cp deploy/README.md    "${STAGE}/README.md"
chmod +x "${STAGE}/install.sh" "${STAGE}/uninstall.sh"

# 4. 打最终包
Info "打包最终分发包..."
tar czf "${PROJ_ROOT}/${ARCHIVE_NAME}" -C "$BUILD_DIR" cloudcli-deploy

ARCHIVE_SIZE=$(du -sh "${PROJ_ROOT}/${ARCHIVE_NAME}" | cut -f1)

Ok "打包完成！"
echo ""
echo "  文件: ${PROJ_ROOT}/${ARCHIVE_NAME}"
echo "  大小: ${ARCHIVE_SIZE}"
echo ""
echo "  分发给同事后，解压并执行:"
echo "    tar xzf ${ARCHIVE_NAME}"
echo "    cd cloudcli-deploy"
echo "    sudo ./install.sh"
