#!/bin/bash
# =============================================================================
# MacroFactor Trader — 阿里云 ECS 全栈一键部署脚本
# =============================================================================
# 用途：在阿里云 ECS 上初始化环境，配置 Nginx + SSL + FastAPI 后端服务
#
# 运行方式（SSH 登录服务器后执行）：
#   bash <(curl -sSL https://raw.githubusercontent.com/YOUR_USER/YOUR_REPO/main/deploy.sh)
# 或手动上传后执行：
#   chmod +x deploy.sh && ./deploy.sh your-email@example.com
#
# 此脚本幂等，可安全重复执行。
# =============================================================================

set -euo pipefail

DOMAIN="ajan03.xyz"
WEB_ROOT="/var/www/$DOMAIN"
FRONTEND_DIR="$WEB_ROOT/frontend"
BACKEND_DIR="$WEB_ROOT/backend"
EMAIL="${1:-your-email@example.com}"
PYTHON_VERSION="3.11"
NODE_VERSION="20"

log() { echo -e "\n[$(date '+%H:%M:%S')] $1"; }

# ─────────────────────────────────────────────────────────────────────────────
# 0. 检查 root 权限
# ─────────────────────────────────────────────────────────────────────────────
if [[ $EUID -ne 0 ]]; then
   echo "❌ 请使用 root 权限运行此脚本：sudo ./deploy.sh"
   exit 1
fi

log "========================================"
log "  MacroFactor Trader 全栈部署"
log "  域名: $DOMAIN"
log "  前端: $FRONTEND_DIR"
log "  后端: $BACKEND_DIR"
log "========================================"

# ─────────────────────────────────────────────────────────────────────────────
# 1. 系统更新 & 安装依赖
# ─────────────────────────────────────────────────────────────────────────────
log "[1/10] 更新系统并安装基础依赖..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get upgrade -y
apt-get install -y \
    nginx curl wget git gnupg2 ca-certificates lsb-release \
    software-properties-common build-essential \
    certbot python3-certbot-nginx \
    rsync openssh-client

# ─────────────────────────────────────────────────────────────────────────────
# 2. 安装 Python 3.11
# ─────────────────────────────────────────────────────────────────────────────
log "[2/10] 安装 Python $PYTHON_VERSION..."
add-apt-repository -y ppa:deadsnakes/ppa 2>/dev/null || true
apt-get update -y
apt-get install -y python3.11 python3.11-venv python3.11-dev python3-pip build-essential
python3.11 --version

# ─────────────────────────────────────────────────────────────────────────────
# 3. 安装 Node.js 20
# ─────────────────────────────────────────────────────────────────────────────
log "[3/10] 安装 Node.js $NODE_VERSION..."
if ! command -v node &> /dev/null || [[ "$(node -v | cut -d'v' -f2 | cut -d'.' -f1)" != "$NODE_VERSION" ]]; then
    curl -fsSL https://deb.nodesource.com/setup_${NODE_VERSION}.x | bash -
    apt-get install -y nodejs
fi
node -v
npm -v

# ─────────────────────────────────────────────────────────────────────────────
# 4. 创建目录结构
# ─────────────────────────────────────────────────────────────────────────────
log "[4/10] 创建部署目录..."
mkdir -p "$FRONTEND_DIR" "$BACKEND_DIR"
chown -R www-data:www-data "$WEB_ROOT"
chmod -R 755 "$WEB_ROOT"

# ─────────────────────────────────────────────────────────────────────────────
# 5. 配置 Nginx（静态文件 + API/WS 反向代理）
# ─────────────────────────────────────────────────────────────────────────────
log "[5/10] 配置 Nginx..."
cat > /etc/nginx/sites-available/$DOMAIN << 'NGINX_EOF'
server {
    listen 80;
    server_name ajan03.xyz www.ajan03.xyz;
    root /var/www/ajan03.xyz/frontend;
    index index.html;

    # Gzip 压缩
    gzip on;
    gzip_vary on;
    gzip_proxied any;
    gzip_comp_level 6;
    gzip_types text/plain text/css text/xml application/json application/javascript application/xml+rss application/atom+xml image/svg+xml;

    # 静态文件缓存
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    # API 反向代理 → FastAPI (uvicorn)
    location /api/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 60s;
        proxy_connect_timeout 60s;
    }

    # WebSocket 反向代理
    location /ws/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
    }

    # FastAPI 文档
    location /docs {
        proxy_pass http://127.0.0.1:8000/docs;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    location /openapi.json {
        proxy_pass http://127.0.0.1:8000/openapi.json;
        proxy_set_header Host $host;
    }

    # Prometheus 指标
    location /metrics {
        proxy_pass http://127.0.0.1:8000/metrics;
        proxy_set_header Host $host;
    }

    # SPA fallback（前端路由）
    location / {
        try_files $uri $uri/ /index.html;
    }
}
NGINX_EOF

ln -sf /etc/nginx/sites-available/$DOMAIN /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl restart nginx
systemctl enable nginx

# ─────────────────────────────────────────────────────────────────────────────
# 6. 申请 SSL 证书 (Let's Encrypt)
# ─────────────────────────────────────────────────────────────────────────────
log "[6/10] 申请 SSL 证书..."
if [[ "$EMAIL" != "your-email@example.com" ]]; then
    certbot --nginx -d $DOMAIN -d www.$DOMAIN --non-interactive --agree-tos -m "$EMAIL" || true
else
    echo "[!] 未提供邮箱，跳过自动 SSL。后续请手动运行："
    echo "    certbot --nginx -d $DOMAIN -d www.$DOMAIN"
fi

# ─────────────────────────────────────────────────────────────────────────────
# 7. 创建后端 Python 虚拟环境并安装依赖
# ─────────────────────────────────────────────────────────────────────────────
log "[7/10] 初始化后端虚拟环境..."
if [[ ! -d "$BACKEND_DIR/venv" ]]; then
    python3.11 -m venv "$BACKEND_DIR/venv"
fi
source "$BACKEND_DIR/venv/bin/activate"
pip install --upgrade pip setuptools wheel

# 如果 requirements.txt 已存在则安装（首次可能为空）
if [[ -f "$BACKEND_DIR/requirements.txt" ]]; then
    pip install -r "$BACKEND_DIR/requirements.txt"
fi

# ─────────────────────────────────────────────────────────────────────────────
# 8. 创建 systemd 服务
# ─────────────────────────────────────────────────────────────────────────────
log "[8/10] 创建 systemd 服务..."
cat > /etc/systemd/system/macrofactor-backend.service << SYSTEMD_EOF
[Unit]
Description=MacroFactor Trader FastAPI Backend
After=network.target

[Service]
Type=simple
User=www-data
Group=www-data
WorkingDirectory=$BACKEND_DIR
Environment=PYTHONPATH=$BACKEND_DIR
Environment=PATH=$BACKEND_DIR/venv/bin:/usr/local/bin:/usr/bin:/bin
ExecStart=$BACKEND_DIR/venv/bin/uvicorn main:app --host 127.0.0.1 --port 8000 --workers 4 --proxy-headers
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=macrofactor-backend

[Install]
WantedBy=multi-user.target
SYSTEMD_EOF

systemctl daemon-reload
systemctl enable macrofactor-backend

# ─────────────────────────────────────────────────────────────────────────────
# 9. 生成 GitHub Actions 部署密钥
# ─────────────────────────────────────────────────────────────────────────────
log "[9/10] 生成 GitHub Actions 部署密钥..."
mkdir -p "$WEB_ROOT/.ssh"
chmod 700 "$WEB_ROOT/.ssh"
if [[ ! -f "$WEB_ROOT/.ssh/deploy_key.pub" ]]; then
    ssh-keygen -t ed25519 -C "github-actions" -f "$WEB_ROOT/.ssh/deploy_key" -N ""
    cat "$WEB_ROOT/.ssh/deploy_key.pub" >> ~/.ssh/authorized_keys
    chmod 600 ~/.ssh/authorized_keys
fi

# ─────────────────────────────────────────────────────────────────────────────
# 10. 完成提示
# ─────────────────────────────────────────────────────────────────────────────
log "[10/10] ✅ 服务器初始化完成！"

PUBLIC_IP=$(curl -s ifconfig.me || echo "你的服务器公网IP")

cat << EOF

========================================
  服务器端配置完成
========================================

【域名解析】
  请在阿里云域名控制台添加 A 记录：
    @   → $PUBLIC_IP
    www → $PUBLIC_IP

【GitHub Secrets 配置】
  打开 GitHub 仓库 → Settings → Secrets and variables → Actions

  添加以下 Secrets：
    DEPLOY_HOST = $PUBLIC_IP
    DEPLOY_USER = root
    DEPLOY_KEY  = （下面私钥的全部内容）

----- DEPLOY_KEY 私钥开始 -----
$(cat "$WEB_ROOT/.ssh/deploy_key")
----- DEPLOY_KEY 私钥结束 -----

【部署验证】
  git push 到 main 分支后，GitHub Actions 会自动：
    1. 构建前端 dist/
    2. 将 dist/ + backend/ 同步到阿里云
    3. 安装后端依赖并重启服务

  验证命令：
    curl https://$DOMAIN/api/health
    curl https://$DOMAIN/docs

【手动重启后端】
  sudo systemctl restart macrofactor-backend
  sudo systemctl status macrofactor-backend
  sudo journalctl -u macrofactor-backend -f

========================================
EOF
