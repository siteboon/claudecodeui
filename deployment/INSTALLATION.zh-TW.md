# Claude Code UI 安裝指南

## 系統需求

- **作業系統**：Linux、WSL 或 macOS
- **Node.js**：18 版或更高版本
- **記憶體**：最少 512MB RAM
- **硬碟空間**：500MB 可用空間
- **網路**：3002 連接埠可用

## 安裝方式

### 選項 1：快速安裝（推薦）

下載並執行安裝程式：

```bash
# 下載最新版本
wget https://github.com/yourusername/claudecodeui/releases/latest/download/claudecodeui-linux-x64.tar.gz

# 解壓縮套件
tar -xzf claudecodeui-linux-x64.tar.gz

# 執行安裝程式
cd claudecodeui-*-linux-x64
sudo ./deployment/scripts/install.sh
```

### 選項 2：從原始碼安裝

複製並從原始碼建置：

```bash
# 複製儲存庫
git clone https://github.com/yourusername/claudecodeui.git
cd claudecodeui

# 安裝依賴項
npm install

# 建置套件
npm run package

# 解壓縮並安裝
cd build
tar -xzf claudecodeui-*-linux-x64.tar.gz
cd claudecodeui-*-linux-x64
sudo ./deployment/scripts/install.sh
```

### 選項 3：Docker 安裝

使用 Docker：

```bash
# 拉取映像檔
docker pull yourusername/claudecodeui:latest

# 使用 docker-compose 執行
wget https://raw.githubusercontent.com/yourusername/claudecodeui/main/deployment/docker-compose.production.yml
docker-compose -f docker-compose.production.yml up -d
```

## 安裝後設定

### 1. 驗證安裝

檢查服務是否正在執行：

```bash
# 檢查服務狀態
sudo systemctl status claudecodeui

# 測試健康檢查端點
curl http://localhost:3002/api/health
```

### 2. 初始設定

1. 開啟瀏覽器並前往 `http://localhost:3002`
2. 建立您的第一個管理員帳號
3. 設定您的 Claude CLI 路徑（如果未自動偵測）

### 3. 安全性設定

生產環境使用：

```bash
# 產生新的 JWT 密鑰
sudo sed -i "s/JWT_SECRET=.*/JWT_SECRET=$(openssl rand -base64 32)/" /etc/claudecodeui/claudecodeui.conf

# 重新啟動服務
sudo systemctl restart claudecodeui
```

## 設定選項

編輯 `/etc/claudecodeui/claudecodeui.conf`：

```bash
# 伺服器設定
PORT=3002                    # 網頁伺服器連接埠
NODE_ENV=production          # 環境模式

# 安全性
JWT_SECRET=<隨機字串>        # 驗證密鑰

# 資料庫
DATABASE_PATH=/opt/claudecodeui/database/claudecodeui.db

# 日誌記錄
LOG_LEVEL=info              # 選項：debug、info、warn、error
```

## 升級

升級現有安裝：

```bash
# 停止服務
sudo systemctl stop claudecodeui

# 備份目前安裝
sudo cp -r /opt/claudecodeui /opt/claudecodeui.backup

# 下載並解壓縮新版本
wget https://github.com/yourusername/claudecodeui/releases/latest/download/claudecodeui-linux-x64.tar.gz
tar -xzf claudecodeui-linux-x64.tar.gz

# 複製新檔案
sudo cp -r claudecodeui-*/dist /opt/claudecodeui/
sudo cp -r claudecodeui-*/server /opt/claudecodeui/
sudo cp -r claudecodeui-*/node_modules /opt/claudecodeui/

# 啟動服務
sudo systemctl start claudecodeui
```

## 解除安裝

移除 Claude Code UI：

```bash
sudo /opt/claudecodeui/deployment/scripts/uninstall.sh
```

這將會：
- 停止並停用服務
- 建立您資料的備份
- 移除應用程式檔案
- 選擇性移除設定和日誌

## 疑難排解

### 服務無法啟動

```bash
# 檢查日誌
sudo journalctl -u claudecodeui -n 100

# 常見修復方法：
# 1. 連接埠已在使用中
sudo lsof -i :3002

# 2. 權限問題
sudo chown -R claudecodeui:claudecodeui /opt/claudecodeui
```

### 無法存取網頁介面

1. 檢查防火牆設定
2. 確認服務正在執行
3. 檢查 nginx/apache 代理設定（如果使用）

### 資料庫錯誤

```bash
# 備份並重設資料庫
sudo cp /opt/claudecodeui/database/claudecodeui.db /tmp/backup.db
sudo rm /opt/claudecodeui/database/claudecodeui.db
sudo systemctl restart claudecodeui
```

## 支援

- GitHub Issues：https://github.com/yourusername/claudecodeui/issues
- 文件：https://github.com/yourusername/claudecodeui/wiki