#!/bin/bash
# 移动端连接诊断脚本

echo "=========================================="
echo "移动端连接诊断"
echo "=========================================="
echo ""

# 检查本地服务
echo "1. 检查后端服务..."
if netstat -tulpn 2>/dev/null | grep -q ':8000'; then
    echo "✓ 后端在 8000 端口运行"
else
    echo "✗ 后端未在 8000 端口运行"
fi

echo ""
echo "2. 检查 Nginx..."
if netstat -tulpn 2>/dev/null | grep -q ':80'; then
    echo "✓ Nginx 在 80 端口运行"
else
    echo "✗ Nginx 未在 80 端口运行"
fi

echo ""
echo "3. 获取本机 IP 地址..."
if command -v hostname &> /dev/null; then
    echo "当前主机名: $(hostname)"
fi

if command -v ifconfig &> /dev/null; then
    echo "IP 地址列表:"
    ifconfig | grep "inet " | grep -v 127.0.0.1
elif command -v ip &> /dev/null; then
    echo "IP 地址列表:"
    ip addr | grep "inet " | grep -v 127.0.0.1
fi

echo ""
echo "4. 测试后端 API..."
curl -s http://localhost:8000/docs > /dev/null 2>&1 && echo "✓ 后端 API 可访问" || echo "✗ 后端 API 无法访问"

echo ""
echo "=========================================="
echo "移动端访问建议："
echo "=========================================="
echo "• 如果是 WiFi 连接，使用: http://[你的IP]:8000 或 http://ajan03.xyz"
echo "• 如果提示 SSL/安全连接错误，需要启用 HTTPS（见下一步）"
echo ""
