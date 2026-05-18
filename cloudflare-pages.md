# Cloudflare Pages 部署指南（国内访问优化）

## 为什么用 Cloudflare Pages？
- 全球 CDN，国内访问比 Vercel 快
- 无需备案
- 自动 HTTPS
- 与 GitHub 集成

## 部署步骤

### 1. 注册 Cloudflare 账号
访问 https://dash.cloudflare.com/sign-up

### 2. 创建 Pages 项目
1. 登录后点击 "Pages" → "Create a project"
2. 选择 "Connect to Git"
3. 授权 GitHub 并选择 `macrofactor-trader` 仓库
4. 构建设置：
   - **Build command**: `npm run build`
   - **Build output directory**: `dist`
   - **Root directory**: `/`

### 3. 添加自定义域名（可选）
1. 在 Pages 项目设置中添加自定义域名
2. 按提示添加 DNS 记录
3. 自动获取 SSL 证书

### 4. 环境变量（如果需要）
在 Pages 设置中添加：
- `VITE_API_BASE_URL` = 你的 API 地址

## 国内访问优化

### 使用 Cloudflare 中国网络
1. 购买 Cloudflare 中国网络服务（需企业版）
2. 或使用 Cloudflare 的免费套餐 + 国内 CDN 回源

### 替代方案：Gitee Pages
1. 将代码推送到 Gitee 仓库
2. 开启 Gitee Pages
3. 国内访问速度极快
4. 缺点：需要实名认证

## 快速部署脚本

```bash
# 安装 Wrangler CLI
npm install -g wrangler

# 登录 Cloudflare
wrangler login

# 部署
wrangler pages deploy dist --project-name=macrofactor-trader
```
