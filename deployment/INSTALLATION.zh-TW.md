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

**重要**：系統沒有預設的使用者名稱/密碼。您必須在第一次訪問系統時建立第一個使用者帳號。

1. 開啟瀏覽器並前往 `http://localhost:3002`
2. 系統將提示您建立第一個管理員帳號：
   - 選擇使用者名稱（最少 3 個字元）
   - 選擇密碼（最少 6 個字元）
3. 建立帳號後，使用您的憑證登入
4. 設定您的 Claude CLI 路徑（如果未自動偵測）

### 3. 重設帳號/密碼（如有需要）

#### 方法 1：使用密碼重設腳本（建議使用）

```bash
# 執行密碼重設腳本
sudo /opt/claudecodeui/deployment/scripts/reset-password.sh

# 依照提示進行：
# 1. 選擇使用者名稱
# 2. 輸入並確認新密碼
# 腳本將自動雜湊密碼並重新啟動服務
```

#### 方法 2：完整資料庫重設

```bash
# 停止服務
sudo systemctl stop claudecodeui

# 移除資料庫檔案
sudo rm /opt/claudecodeui/server/database/auth.db

# 啟動服務（將建立新的資料庫）
sudo systemctl start claudecodeui

# 前往 http://localhost:3002 並建立新帳號
```

#### 方法 3：手動重設密碼

```bash
# 首先，為您的新密碼產生 bcrypt 雜湊值
cd /opt/claudecodeui
node -e "const bcrypt = require('bcrypt'); bcrypt.hash('your-new-password', 12).then(hash => console.log(hash));"

# 連接到資料庫
sudo sqlite3 /opt/claudecodeui/server/database/auth.db

# 查看現有使用者
SELECT id, username FROM users;

# 更新密碼（將 'admin' 替換為您的使用者名稱，並使用上面產生的雜湊值）
UPDATE users SET password_hash = '$2b$12$YourGeneratedHashHere' WHERE username = 'admin';

# 離開 sqlite
.quit

# 重新啟動服務
sudo systemctl restart claudecodeui
```

**注意**：資料庫欄位名稱是 `password_hash`，而非 `password`。

### 4. 安全性設定

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

# 檢查錯誤日誌
sudo tail -50 /var/log/claudecodeui/error.log

# 常見修復方法：
# 1. 連接埠已在使用中
sudo lsof -i :3002

# 2. 權限問題
sudo chown -R claudecodeui:claudecodeui /opt/claudecodeui
sudo chown -R claudecodeui:claudecodeui /home/claudecodeui
sudo chmod 755 /opt/claudecodeui/server/database

# 3. 缺少 .env 檔案
sudo bash -c 'cat > /opt/claudecodeui/.env << EOF
PORT=3002
NODE_ENV=production
EOF'
sudo chown claudecodeui:claudecodeui /opt/claudecodeui/.env
```

### 無法存取網頁介面

1. 檢查防火牆設定
2. 確認服務正在執行：`sudo systemctl status claudecodeui`
3. 檢查連接埠是否監聽中：`sudo netstat -tlnp | grep 3002`
4. 清除瀏覽器快取或嘗試無痕模式
5. 檢查 nginx/apache 代理設定（如果使用）

### 資料庫錯誤

```bash
# 資料庫是唯讀的
sudo chmod 664 /opt/claudecodeui/server/database/auth.db
sudo chown claudecodeui:claudecodeui /opt/claudecodeui/server/database/auth.db
sudo systemctl restart claudecodeui

# 無法建立資料庫
sudo mkdir -p /opt/claudecodeui/server/database
sudo chown -R claudecodeui:claudecodeui /opt/claudecodeui/server/database
sudo chmod 755 /opt/claudecodeui/server/database

# 完整資料庫重設
sudo systemctl stop claudecodeui
sudo rm -f /opt/claudecodeui/server/database/auth.db
sudo systemctl start claudecodeui
```

### 註冊失敗並出現 500 錯誤

這通常表示資料庫權限問題：

```bash
# 修復資料庫權限
sudo chown -R claudecodeui:claudecodeui /opt/claudecodeui/server/database
sudo chmod 755 /opt/claudecodeui/server/database
sudo chmod 664 /opt/claudecodeui/server/database/auth.db

# 重新啟動服務
sudo systemctl restart claudecodeui
```

### 靜態資源無法載入

如果 CSS/JS 檔案無法載入：

1. 完全清除瀏覽器快取
2. 嘗試無痕/私密瀏覽模式
3. 檢查 Service Worker：開啟 DevTools → Application → Service Workers → Unregister
4. 強制重新整理：Ctrl+F5（Windows/Linux）或 Cmd+Shift+R（Mac）

## 支援

- GitHub Issues：https://github.com/yourusername/claudecodeui/issues
- 文件：https://github.com/yourusername/claudecodeui/wiki