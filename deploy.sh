#!/bin/bash
# 阿里云 ECS 一键部署脚本
# 用法：SSH 登录服务器后，运行：bash <(curl -sSL https://raw.githubusercontent.com/你的用户名/你的仓库/main/deploy.sh)
# 或先上传此文件到服务器，然后运行：chmod +x deploy.sh && ./deploy.sh

set -e

DOMAIN="ajan03.xyz"
WEB_ROOT="/var/www/$DOMAIN"
EMAIL="${1:-your-email@example.com}"

echo "========================================"
echo "  Macrofactor Trader 一键部署脚本"
echo "  域名: $DOMAIN"
echo "========================================"

# 1. 更新系统
echo "[1/8] 更新系统..."
apt-get update -y
apt-get upgrade -y

# 2. 安装必要软件
echo "[2/8] 安装 Nginx、Certbot、Node.js..."
apt-get install -y nginx curl gnupg2 ca-certificates lsb-release software-properties-common

# 添加 NodeSource 源并安装 Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs

# 3. 创建网站目录
echo "[3/8] 创建目录 $WEB_ROOT..."
mkdir -p "$WEB_ROOT"
chown -R www-data:www-data "$WEB_ROOT"
chmod -R 755 "$WEB_ROOT"

# 4. 配置 Nginx
echo "[4/8] 配置 Nginx..."
cat > /etc/nginx/sites-available/$DOMAIN << 'NGINX_EOF'
server {
    listen 80;
    server_name ajan03.xyz www.ajan03.xyz;
    root /var/www/ajan03.xyz;
    index index.html;

    # Gzip
    gzip on;
    gzip_vary on;
    gzip_proxied any;
    gzip_comp_level 6;
    gzip_types text/plain text/css text/xml application/json application/javascript application/xml+rss application/atom+xml image/svg+xml;

    # 静态缓存
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    # SPA fallback
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

# 5. 申请 SSL
echo "[5/8] 申请 SSL 证书 (Let's Encrypt)..."
apt-get install -y certbot python3-certbot-nginx

if [ "$EMAIL" != "your-email@example.com" ]; then
    certbot --nginx -d $DOMAIN -d www.$DOMAIN --non-interactive --agree-tos -m "$EMAIL" || true
else
    echo "[!] 跳过自动 SSL（未提供邮箱）。如需要 HTTPS，请手动运行："
    echo "    certbot --nginx -d $DOMAIN -d www.$DOMAIN"
fi

# 6. 生成 GitHub Actions 部署密钥
echo "[6/8] 生成 GitHub Actions 部署密钥..."
mkdir -p "$WEB_ROOT/.ssh"
if [ ! -f "$WEB_ROOT/.ssh/deploy_key.pub" ]; then
    ssh-keygen -t ed25519 -C "github-actions" -f "$WEB_ROOT/.ssh/deploy_key" -N ""
    cat "$WEB_ROOT/.ssh/deploy_key.pub" >> ~/.ssh/authorized_keys
    chmod 600 ~/.ssh/authorized_keys
fi

echo ""
echo "========================================"
echo "  服务器端配置完成！"
echo "========================================"
echo ""
echo "【下一步】请把以下内容添加到 GitHub Secrets："
echo ""
echo "  1. 打开你的 GitHub 仓库"
echo "  2. Settings → Secrets and variables → Actions → New repository secret"
echo ""
echo "  DEPLOY_HOST = $(curl -s ifconfig.me || echo '你的服务器公网IP')"
echo "  DEPLOY_USER = $(whoami)"
echo "  DEPLOY_KEY  = （下面私钥的全部内容）"
echo ""
echo "----- DEPLOY_KEY 私钥开始 -----"
cat "$WEB_ROOT/.ssh/deploy_key"
echo "----- DEPLOY_KEY 私钥结束 -----"
echo ""
echo "【域名解析】"
echo "  请在阿里云域名控制台添加 A 记录："
echo "    @   → $(curl -s ifconfig.me || echo '你的服务器公网IP')"
echo "    www → $(curl -s ifconfig.me || echo '你的服务器公网IP')"
echo ""
echo "【部署】"
echo "  git push 后 GitHub Actions 会自动构建并部署到 $WEB_ROOT"
echo ""
