# 部署指南：GitHub Actions → 阿里云 ECS

> 目标：`git push` 自动构建并部署到 `https://ajan03.xyz/`

---

## 一、服务器端准备（阿里云 ECS）

### 1. 连接服务器，创建部署目录

```bash
ssh root@你的服务器IP

# 创建目录
mkdir -p /var/www/ajan03.xyz
mkdir -p /var/www/ajan03.xyz/.ssh

# 安装 Nginx
apt update && apt install -y nginx

# 安装 Node.js 20（构建需要）
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs
```

### 2. 生成 GitHub Actions 专用 SSH 密钥

```bash
# 在服务器上生成密钥（不要设密码）
ssh-keygen -t ed25519 -C "github-actions" -f /var/www/ajan03.xyz/.ssh/deploy_key

# 查看公钥，等下添加到服务器的 authorized_keys
cat /var/www/ajan03.xyz/.ssh/deploy_key.pub

# 查看私钥，等下添加到 GitHub Secrets
cat /var/www/ajan03.xyz/.ssh/deploy_key
```

把公钥追加到 `authorized_keys`：
```bash
cat /var/www/ajan03.xyz/.ssh/deploy_key.pub >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
```

---

## 二、GitHub 仓库配置

### 1. 把代码推送到 GitHub

```bash
cd app
git init
git add .
git commit -m "init"
git branch -M main
git remote add origin https://github.com/你的用户名/你的仓库.git
git push -u origin main
```

### 2. 添加 GitHub Secrets

进入 GitHub 仓库 → Settings → Secrets and variables → Actions → New repository secret

| Secret 名称 | 值 |
|---|---|
| `DEPLOY_HOST` | 你的阿里云服务器 IP |
| `DEPLOY_USER` | `root`（或你的服务器用户名）|
| `DEPLOY_KEY` | 上面生成的私钥内容（`deploy_key` 文件的全部内容）|

---

## 三、GitHub Actions CI/CD 配置

我已为你创建好 `.github/workflows/deploy.yml`，推送后会自动触发：

```yaml
name: Deploy to Alibaba Cloud

on:
  push:
    branches: [main]

jobs:
  build-and-deploy:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 20

      - name: Install dependencies
        working-directory: ./app
        run: npm ci

      - name: Build
        working-directory: ./app
        run: npm run build

      - name: Deploy to server via SSH
        uses: appleboy/scp-action@v0.1.7
        with:
          host: ${{ secrets.DEPLOY_HOST }}
          username: ${{ secrets.DEPLOY_USER }}
          key: ${{ secrets.DEPLOY_KEY }}
          source: "app/dist/*"
          target: "/var/www/ajan03.xyz/"
          strip_components: 2
          rm: true
```

---

## 四、服务器 Nginx 配置

创建 `/etc/nginx/sites-available/ajan03.xyz`：

```nginx
server {
    listen 80;
    server_name ajan03.xyz www.ajan03.xyz;
    root /var/www/ajan03.xyz;
    index index.html;

    # Gzip 压缩
    gzip on;
    gzip_vary on;
    gzip_proxied any;
    gzip_comp_level 6;
    gzip_types text/plain text/css text/xml application/json application/javascript application/xml+rss application/atom+xml image/svg+xml;

    # 静态资源长期缓存
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    # SPA 路由回退
    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

启用配置：
```bash
ln -sf /etc/nginx/sites-available/ajan03.xyz /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl restart nginx
```

---

## 五、SSL 证书（HTTPS）

```bash
apt install -y certbot python3-certbot-nginx
certbot --nginx -d ajan03.xyz -d www.ajan03.xyz --non-interactive --agree-tos -m your-email@example.com

# 自动续期已默认启用
systemctl status certbot.timer
```

---

## 六、域名解析配置

登录阿里云域名控制台 → 解析设置 → 添加记录：

| 记录类型 | 主机记录 | 解析线路 | 记录值 |
|---|---|---|---|
| A | @ | 默认 | 你的服务器公网IP |
| A | www | 默认 | 你的服务器公网IP |

等 5-10 分钟生效后访问 `https://ajan03.xyz/`。

---

## 七、验证部署

以后每次改代码，只需：

```bash
git add .
git commit -m "update"
git push origin main
```

GitHub Actions 会自动：
1. 拉取最新代码
2. `npm ci` + `npm run build`
3. 把 `dist/` 传到服务器 `/var/www/ajan03.xyz/`
4. Nginx 立即 serve 新文件

在 GitHub 仓库的 Actions 标签页可以查看部署日志。
