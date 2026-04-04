#!/usr/bin/env bash
# =============================================================================
# CloudCLI — 卸载脚本
# 用法: sudo ./uninstall.sh
# =============================================================================

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

Info()  { echo -e "${BLUE}[INFO]${NC}  $*"; }
Ok()    { echo -e "${GREEN}[OK]${NC}    $*"; }

LAUNCHD_LABEL="com.cloudcli.server"
LAUNCHD_PLIST="/Library/LaunchDaemons/${LAUNCHD_LABEL}.plist"
INSTALL_DIR="/opt/cloudcli"

if [[ $EUID -ne 0 ]]; then
    echo -e "${RED}[ERROR]${NC} 请使用 sudo 运行"
    exit 1
fi

# 停止服务
if launchctl list "$LAUNCHD_LABEL" &>/dev/null 2>&1; then
    Info "停止服务..."
    launchctl bootout system/"$LAUNCHD_LABEL" 2>/dev/null || true
    Ok "已停止"
fi

# 移除 plist
if [[ -f "$LAUNCHD_PLIST" ]]; then
    rm -f "$LAUNCHD_PLIST"
    Ok "已删除 launchd 配置"
fi

# 移除全局命令
if [[ -L "/usr/local/bin/cloudcli" ]]; then
    rm -f "/usr/local/bin/cloudcli"
    Ok "已删除全局命令"
fi

# 移除安装目录
if [[ -d "$INSTALL_DIR" ]]; then
    rm -rf "$INSTALL_DIR"
    Ok "已删除安装目录 ${INSTALL_DIR}"
fi

# 移除日志
if [[ -d "/var/log/cloudcli" ]]; then
    rm -rf "/var/log/cloudcli"
    Ok "已删除日志目录"
fi

echo ""
echo -e "${GREEN}卸载完成。${NC}"
echo -e "用户数据保留在 ~/.cloudcli/，如需清理请手动删除。"
