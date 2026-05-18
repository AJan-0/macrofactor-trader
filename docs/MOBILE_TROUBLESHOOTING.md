# 移动端无法连接问题解决方案

## 问题分析

Safari 报错 **"无法与服务器建立安全的连接"** 通常由以下原因引起：

1. **HTTP vs HTTPS 不匹配** - Safari 对安全连接要求严格
2. **CORS 配置问题** - 跨域请求被阻止
3. **WebSocket 连接失败** - 实时数据流无法建立
4. **DNS/网络问题** - 域名无法解析或网络不通

---

## 快速诊断

### 第一步：确认访问地址
```bash
# 在移动设备上访问下列地址之一：
- 如果在局域网：http://[你的电脑IP]:8000/docs
- 如果通过域名：http://ajan03.xyz/
- 查看浏览器地址栏的完整 URL
```

### 第二步：检查后端日志
```bash
# 查看后端是否收到移动端请求
cd backend
tail -f logs/app.log  # 或直接查看 uvicorn 输出
# 应该能看到来自移动设备 IP 的请求
```

---

## 方案 A：本地开发环境（同一 WiFi 网络）

### A1. 获取电脑 IP 地址

**Windows:**
```powershell
ipconfig
# 查找 "IPv4 地址" 字段，通常格式: 192.168.x.x 或 10.0.x.x
```

**macOS/Linux:**
```bash
ifconfig
# 查找 en0 或 eth0 的 inet 地址
```

### A2. 启动后端服务

```bash
cd backend
# 使用 0.0.0.0 确保允许外部连接
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

### A3. 配置前端环境变量

创建 `.env.local`：
```
VITE_API_URL=http://YOUR_IP:8000
VITE_WS_URL=ws://YOUR_IP:8000
```

示例（假设你的 IP 是 192.168.1.100）：
```
VITE_API_URL=http://192.168.1.100:8000
VITE_WS_URL=ws://192.168.1.100:8000
```

### A4. 启动前端开发服务

```bash
npm run dev
# 访问 http://192.168.1.100:3000（在移动设备浏览器中）
```

### A5. 重要：禁用 Vite 代理（因为移动端无法访问代理）

编辑 `vite.config.ts`：
```typescript
// 在开发时，移动端直接连接后端，不通过 Vite 代理
server: {
  port: 3000,
  // proxy: { ... } // 注释掉这部分，或在移动端环境下禁用
}
```

---

## 方案 B：带 SSL 的生产环境（推荐）

如果需要 HTTPS，首先为 Nginx 配置 SSL：

### B1. 获取 SSL 证书

使用 Let's Encrypt（免费）：
```bash
# 使用 certbot
sudo apt-get install certbot python3-certbot-nginx
sudo certbot certonly --nginx -d ajan03.xyz -d www.ajan03.xyz
```

### B2. 更新 Nginx 配置

编辑 `nginx.conf`：
```nginx
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name ajan03.xyz www.ajan03.xyz;
    root /var/www/ajan03.xyz;
    
    # SSL 证书配置
    ssl_certificate /etc/letsencrypt/live/ajan03.xyz/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/ajan03.xyz/privkey.pem;
    
    # SSL 安全配置
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 10m;
    
    # HSTS（可选，强制 HTTPS）
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    
    # 其他配置...
    gzip on;
    location / {
        try_files $uri $uri/ /index.html;
    }
    
    # 反向代理到后端
    location /api {
        proxy_pass http://localhost:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
    
    location /ws {
        proxy_pass http://localhost:8000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

# HTTP 重定向到 HTTPS
server {
    listen 80;
    listen [::]:80;
    server_name ajan03.xyz www.ajan03.xyz;
    return 301 https://$server_name$request_uri;
}
```

### B3. 更新后端 CORS 配置

编辑 `backend/.env` 或启动参数：
```
ENV=production
CORS_ORIGINS=https://ajan03.xyz,https://www.ajan03.xyz
```

### B4. 前端环境变量

```
VITE_API_URL=https://ajan03.xyz/api
VITE_WS_URL=wss://ajan03.xyz/ws
```

---

## 方案 C：修复常见问题

### C1. WebSocket 连接失败

检查 `src/services/klineStream.ts` 中 WebSocket URL 构建逻辑：
```typescript
function wsUrl(): string {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = location.host;
  // 确保协议和主机匹配
  return `${proto}//${host}/ws/klines`;
}
```

### C2. 混合内容错误（HTTPS 加载 HTTP）

如果前端是 HTTPS 但后端是 HTTP，Safari 会拒绝。解决方案：
1. 后端也配置 HTTPS（推荐）
2. 或在 HTML meta 标签中添加：
```html
<meta http-equiv="Content-Security-Policy" 
      content="upgrade-insecure-requests">
```

### C3. CORS 错误

如果移动端看到 CORS 错误，确保后端 CORS 配置包含前端域名：
```python
# backend/config.py
cors_origins="https://ajan03.xyz,https://www.ajan03.xyz"
```

---

## 调试步骤

### 步骤 1：检查网络连接
```bash
# 从电脑测试后端是否可访问
curl http://localhost:8000/health  # 或 /api/health
curl http://YOUR_IP:8000/health    # 从移动设备 WiFi IP 测试
```

### 步骤 2：查看浏览器控制台
移动 Safari：设置 → Safari → 高级 → Web Inspector → 打开
- 查看 Network 标签中的请求是否成功
- 查看 Console 标签中的错误信息

### 步骤 3：测试 WebSocket
```javascript
// 在浏览器控制台中运行
const ws = new WebSocket('ws://YOUR_IP:8000/ws/klines');
ws.onopen = () => console.log('WS Connected');
ws.onerror = (e) => console.error('WS Error', e);
```

---

## 快速检查列表

- [ ] 后端服务运行在 0.0.0.0:8000
- [ ] 前端和移动端在同一 WiFi 网络
- [ ] 环境变量 VITE_API_URL 和 VITE_WS_URL 正确设置
- [ ] Nginx 配置中有 `/api` 和 `/ws` 反向代理规则
- [ ] 后端 CORS 配置包含前端域名或设置为 `*`
- [ ] SSL 证书有效（如使用 HTTPS）
- [ ] WebSocket 连接没有被防火墙阻止

---

## 获取更多帮助

运行诊断脚本：
```bash
bash diagnose-mobile.sh
```

检查日志：
```bash
# 后端日志
cd backend && tail -f app.log

# Nginx 日志
tail -f /var/log/nginx/access.log
tail -f /var/log/nginx/error.log
```
