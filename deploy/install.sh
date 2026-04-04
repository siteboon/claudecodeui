#!/usr/bin/env bash
# =============================================================================
# CloudCLI (claudecodeui fork) — macOS 一键安装脚本
#
# 功能:
#   1. 检测并安装依赖 (Node.js >= 20)
#   2. 如已安装官方 cloudcli，先停止并卸载
#   3. 解压安装包到 /opt/cloudcli
#   4. 安装生产依赖 + 构建原生模块
#   5. 注册 launchd 开机自启动
#   6. 立即启动服务
#
# 用法:
#   chmod +x install.sh
#   sudo ./install.sh
# =============================================================================

set -euo pipefail

# ── 颜色定义 ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
NC='\033[0m'

Info()  { echo -e "${BLUE}[INFO]${NC}  $*"; }
Ok()    { echo -e "${GREEN}[OK]${NC}    $*"; }
Warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
Error() { echo -e "${RED}[ERROR]${NC} $*"; }

# ── 配置 ─────────────────────────────────────────────────────────────────────
INSTALL_DIR="/opt/cloudcli"
LAUNCHD_LABEL="com.cloudcli.server"
LAUNCHD_PLIST="/Library/LaunchDaemons/${LAUNCHD_LABEL}.plist"
SERVICE_PORT="${CLOUDCLI_PORT:-3001}"
LOG_DIR="/var/log/cloudcli"
DATA_DIR="/var/lib/cloudcli"

# 获取实际执行用户 (sudo 场景下获取原始用户)
REAL_USER="${SUDO_USER:-$(whoami)}"
REAL_HOME=$(eval echo "~${REAL_USER}")

# ── 前置检查 ─────────────────────────────────────────────────────────────────
if [[ $EUID -ne 0 ]]; then
    Error "请使用 sudo 运行此脚本"
    echo "  sudo $0"
    exit 1
fi

Info "安装用户: ${REAL_USER}, HOME: ${REAL_HOME}"

# ── 检测 Node.js ─────────────────────────────────────────────────────────────
CheckNode() {
    if ! command -v node &>/dev/null; then
        Error "未检测到 Node.js，请先安装 Node.js >= 20"
        echo "  推荐: brew install node"
        echo "  或:   https://nodejs.org/"
        exit 1
    fi

    local node_version
    node_version=$(node -v | sed 's/^v//')
    local major
    major=$(echo "$node_version" | cut -d. -f1)

    if [[ "$major" -lt 20 ]]; then
        Error "Node.js 版本过低: v${node_version}，需要 >= 20"
        exit 1
    fi

    Ok "Node.js v${node_version}"
}

# ── 停止并卸载已有的 cloudcli ──────────────────────────────────────────────
StopExisting() {
    # 停止 launchd 服务 (如果存在)
    if launchctl list "$LAUNCHD_LABEL" &>/dev/null 2>&1; then
        Info "停止已有的 cloudcli launchd 服务..."
        launchctl bootout system/"$LAUNCHD_LABEL" 2>/dev/null || true
        Ok "已停止 launchd 服务"
    fi

    # 杀掉可能残留的 cloudcli 进程
    local pids
    pids=$(pgrep -f "node.*cloudcli" 2>/dev/null || true)
    if [[ -n "$pids" ]]; then
        Info "终止残留的 cloudcli 进程: $pids"
        echo "$pids" | xargs kill -TERM 2>/dev/null || true
        sleep 2
        echo "$pids" | xargs kill -9 2>/dev/null || true
    fi

    # 卸载全局 npm 包 (如果存在)
    if npm list -g @cloudcli-ai/cloudcli &>/dev/null 2>&1; then
        Info "卸载全局 npm 包 @cloudcli-ai/cloudcli..."
        npm uninstall -g @cloudcli-ai/cloudcli 2>/dev/null || true
        Ok "已卸载全局 npm 包"
    fi
}

# ── 安装应用 ──────────────────────────────────────────────────────────────────
InstallApp() {
    local script_dir
    script_dir=$(cd "$(dirname "$0")" && pwd)
    local archive="${script_dir}/cloudcli.tar.gz"

    if [[ ! -f "$archive" ]]; then
        Error "未找到安装包: ${archive}"
        echo "  请将 cloudcli.tar.gz 放在 install.sh 同目录下"
        exit 1
    fi

    # 备份旧安装
    if [[ -d "$INSTALL_DIR" ]]; then
        local backup="${INSTALL_DIR}.bak.$(date +%Y%m%d%H%M%S)"
        Warn "备份旧安装到 ${backup}"
        mv "$INSTALL_DIR" "$backup"
    fi

    Info "解压安装包到 ${INSTALL_DIR}..."
    mkdir -p "$INSTALL_DIR"
    tar xzf "$archive" -C "$INSTALL_DIR" --strip-components=1

    Info "安装生产依赖 (含原生模块编译，可能需要几分钟)..."
    cd "$INSTALL_DIR"
    # --ignore-scripts: 跳过 prepare (husky) 等仅开发时需要的生命周期脚本
    npm ci --omit=dev --ignore-scripts 2>&1 | tail -5

    # 手动执行 postinstall: 修复 node-pty spawn-helper 权限 (macOS 已知问题)
    if [[ -f "${INSTALL_DIR}/scripts/fix-node-pty.js" ]]; then
        Info "修复 node-pty 权限..."
        node "${INSTALL_DIR}/scripts/fix-node-pty.js" 2>/dev/null || true
    fi

    # 重新编译原生模块 (--ignore-scripts 跳过了自动编译)
    Info "编译原生模块..."
    npm rebuild 2>&1 | tail -5

    Ok "应用安装完成"
}

# ── 创建目录与环境配置 ────────────────────────────────────────────────────────
SetupEnvironment() {
    mkdir -p "$LOG_DIR"
    mkdir -p "$DATA_DIR"
    mkdir -p "${REAL_HOME}/.cloudcli"

    # 创建 .env (如果不存在)
    local env_file="${INSTALL_DIR}/.env"
    if [[ ! -f "$env_file" ]]; then
        Info "创建 .env 配置文件..."
        cat > "$env_file" <<EOF
# CloudCLI 配置
SERVER_PORT=${SERVICE_PORT}
DATABASE_PATH=${REAL_HOME}/.cloudcli/auth.db
EOF
    fi

    # 修正 home 目录权限
    chown -R "${REAL_USER}" "${REAL_HOME}/.cloudcli"

    Ok "环境配置完成"
}

# ── 创建全局命令链接 ──────────────────────────────────────────────────────────
CreateSymlink() {
    local bin_path="/usr/local/bin/cloudcli"
    if [[ -L "$bin_path" ]] || [[ -f "$bin_path" ]]; then
        rm -f "$bin_path"
    fi
    ln -sf "${INSTALL_DIR}/server/cli.js" "$bin_path"
    chmod +x "${INSTALL_DIR}/server/cli.js"
    Ok "已创建全局命令: cloudcli"
}

# ── 配置 launchd 开机自启动 ───────────────────────────────────────────────────
SetupLaunchd() {
    Info "配置 launchd 开机自启动..."

    local node_path
    node_path=$(which node)

    cat > "$LAUNCHD_PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${LAUNCHD_LABEL}</string>

    <key>ProgramArguments</key>
    <array>
        <string>${node_path}</string>
        <string>${INSTALL_DIR}/server/cli.js</string>
        <string>start</string>
    </array>

    <key>WorkingDirectory</key>
    <string>${INSTALL_DIR}</string>

    <key>UserName</key>
    <string>${REAL_USER}</string>

    <key>EnvironmentVariables</key>
    <dict>
        <key>HOME</key>
        <string>${REAL_HOME}</string>
        <key>PATH</key>
        <string>/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
        <key>SERVER_PORT</key>
        <string>${SERVICE_PORT}</string>
        <key>DATABASE_PATH</key>
        <string>${REAL_HOME}/.cloudcli/auth.db</string>
        <key>NODE_ENV</key>
        <string>production</string>
    </dict>

    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>

    <key>StandardOutPath</key>
    <string>${LOG_DIR}/cloudcli.log</string>
    <key>StandardErrorPath</key>
    <string>${LOG_DIR}/cloudcli-error.log</string>

    <key>SoftResourceLimits</key>
    <dict>
        <key>NumberOfFiles</key>
        <integer>65536</integer>
    </dict>
</dict>
</plist>
EOF

    # 设置正确权限，launchd 要求 644
    chmod 644 "$LAUNCHD_PLIST"
    chown root:wheel "$LAUNCHD_PLIST"

    Ok "launchd 配置写入 ${LAUNCHD_PLIST}"
}

# ── 启动服务 ──────────────────────────────────────────────────────────────────
StartService() {
    Info "启动 cloudcli 服务..."
    launchctl bootstrap system "$LAUNCHD_PLIST"

    # 等待启动
    sleep 3

    if launchctl list "$LAUNCHD_LABEL" &>/dev/null 2>&1; then
        Ok "服务已启动"
        echo ""
        echo -e "  ${GREEN}访问地址:${NC}  http://localhost:${SERVICE_PORT}"
        echo -e "  ${GREEN}日志文件:${NC}  ${LOG_DIR}/cloudcli.log"
        echo -e "  ${GREEN}错误日志:${NC}  ${LOG_DIR}/cloudcli-error.log"
        echo -e "  ${GREEN}安装目录:${NC}  ${INSTALL_DIR}"
        echo -e "  ${GREEN}数据目录:${NC}  ${REAL_HOME}/.cloudcli/"
        echo ""
        echo -e "  ${BLUE}管理命令:${NC}"
        echo "    cloudcli status          # 查看状态"
        echo "    sudo launchctl kickstart -k system/${LAUNCHD_LABEL}  # 重启"
        echo "    sudo launchctl bootout system/${LAUNCHD_LABEL}       # 停止"
        echo ""
    else
        Warn "服务可能未成功启动，请检查日志:"
        echo "  cat ${LOG_DIR}/cloudcli-error.log"
    fi
}

# ── 主流程 ────────────────────────────────────────────────────────────────────
main() {
    echo ""
    echo "╔═══════════════════════════════════════════════════════════╗"
    echo "║         CloudCLI (claudecodeui) — macOS 安装程序          ║"
    echo "╚═══════════════════════════════════════════════════════════╝"
    echo ""

    CheckNode
    StopExisting
    InstallApp
    SetupEnvironment
    CreateSymlink
    SetupLaunchd
    StartService

    Ok "安装完成！"
}

main "$@"
