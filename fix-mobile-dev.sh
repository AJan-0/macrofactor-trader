#!/bin/bash
# 快速修复移动端连接问题

set -e

echo "=========================================="
echo "移动端连接快速修复"
echo "=========================================="
echo ""

# 1. 获取本机 IP
echo "1️⃣  获取本机 IP 地址..."
if [[ "$OSTYPE" == "linux-gnu"* ]]; then
    LOCAL_IP=$(hostname -I | awk '{print $1}')
elif [[ "$OSTYPE" == "darwin"* ]]; then
    LOCAL_IP=$(ifconfig | grep "inet " | grep -v 127.0.0.1 | head -1 | awk '{print $2}')
else
    echo "⚠️  无法自动获取 IP，请手动获取后编辑 .env.local"
    LOCAL_IP="YOUR_IP"
fi

echo "✓ 本机 IP: $LOCAL_IP"
echo ""

# 2. 创建 .env.local
echo "2️⃣  创建前端环境变量文件..."
cat > .env.local << EOF
# 移动端开发环境配置
VITE_API_URL=http://$LOCAL_IP:8000
VITE_WS_URL=ws://$LOCAL_IP:8000
EOF
echo "✓ .env.local 已创建"
echo ""

# 3. 创建后端 .env（如果不存在）
if [ ! -f backend/.env ]; then
    echo "3️⃣  创建后端环境变量文件..."
    cat > backend/.env << EOF
# 后端配置
ENV=development
CORS_ORIGINS=*
CACHE_BACKEND=memory
DATABASE_URL=sqlite+aiosqlite:///./macrofactor.db
EOF
    echo "✓ backend/.env 已创建"
else
    echo "3️⃣  backend/.env 已存在，跳过"
fi
echo ""

# 4. 启动说明
echo "=========================================="
echo "4️⃣  启动步骤："
echo "=========================================="
echo ""
echo "🔵 终端 1 - 启动后端："
echo "   cd backend"
echo "   uvicorn main:app --host 0.0.0.0 --port 8000 --reload"
echo ""
echo "🟢 终端 2 - 启动前端："
echo "   npm run dev"
echo ""
echo "📱 移动设备访问："
echo "   http://$LOCAL_IP:3000"
echo ""
echo "=========================================="
echo ""
echo "⚠️  重要提示："
echo "  • 移动设备必须与电脑连接到同一 WiFi"
echo "  • 如果还是无法连接，检查防火墙是否允许 8000/3000 端口"
echo "  • 如果看到 SSL 错误，参考 MOBILE_TROUBLESHOOTING.md"
echo ""
