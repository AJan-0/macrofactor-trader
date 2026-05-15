# 快速修复移动端连接问题 (Windows PowerShell)

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "移动端连接快速修复 (Windows)" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""

# 1. 获取本机 IP
Write-Host "1️⃣  获取本机 IP 地址..." -ForegroundColor Yellow

# 获取所有 IPv4 地址（排除 127.0.0.1 和虚拟网卡）
$ips = @()
$adapters = Get-NetIPConfiguration -InterfaceAlias * -ErrorAction SilentlyContinue | 
    Where-Object { $_.NetAdapter.Status -eq "Up" }

foreach ($adapter in $adapters) {
    if ($adapter.IPv4Address -and $adapter.IPv4Address.IPAddress -ne "127.0.0.1") {
        $ips += $adapter.IPv4Address.IPAddress
    }
}

if ($ips.Count -eq 0) {
    Write-Host "⚠️  未找到有效的 IP 地址，请手动编辑 .env.local" -ForegroundColor Yellow
    $LOCAL_IP = "YOUR_IP"
} else {
    # 使用第一个有效的 IP
    $LOCAL_IP = $ips[0]
    Write-Host "✓ 本机 IP: $LOCAL_IP" -ForegroundColor Green
}

Write-Host ""

# 2. 创建前端 .env.local
Write-Host "2️⃣  创建前端环境变量文件..." -ForegroundColor Yellow

$env_content = @"
# 移动端开发环境配置
VITE_API_URL=http://$LOCAL_IP`:8000
VITE_WS_URL=ws://$LOCAL_IP`:8000
"@

Set-Content -Path ".env.local" -Value $env_content -Encoding UTF8
Write-Host "✓ .env.local 已创建" -ForegroundColor Green
Write-Host ""

# 3. 创建后端 .env（如果不存在）
Write-Host "3️⃣  创建后端环境变量文件..." -ForegroundColor Yellow

if (-Not (Test-Path "backend\.env")) {
    $backend_env_content = @"
# 后端配置
ENV=development
CORS_ORIGINS=*
CACHE_BACKEND=memory
DATABASE_URL=sqlite+aiosqlite:///./macrofactor.db
"@
    Set-Content -Path "backend\.env" -Value $backend_env_content -Encoding UTF8
    Write-Host "✓ backend\.env 已创建" -ForegroundColor Green
} else {
    Write-Host "✓ backend\.env 已存在，跳过" -ForegroundColor Green
}
Write-Host ""

# 4. 启动说明
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "4️⃣  启动步骤：" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""

Write-Host "🔵 终端 1 - 启动后端：" -ForegroundColor Blue
Write-Host "   cd backend"
Write-Host "   python -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload"
Write-Host ""

Write-Host "🟢 终端 2 - 启动前端：" -ForegroundColor Green
Write-Host "   npm run dev"
Write-Host ""

Write-Host "📱 移动设备访问：" -ForegroundColor Magenta
Write-Host "   http://$LOCAL_IP`:3000" -ForegroundColor Magenta
Write-Host ""

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""

Write-Host "⚠️  重要提示：" -ForegroundColor Yellow
Write-Host "  • 移动设备必须与电脑连接到同一 WiFi" -ForegroundColor Yellow
Write-Host "  • 如果看到防火墙提示，请允许访问" -ForegroundColor Yellow
Write-Host "  • 如果还是无法连接，查看 MOBILE_TROUBLESHOOTING.md" -ForegroundColor Yellow
Write-Host ""

# 5. 防火墙检查
Write-Host "5️⃣  防火墙检查..." -ForegroundColor Yellow
$port8000 = Test-NetConnection -ComputerName localhost -Port 8000 -WarningAction SilentlyContinue
$port3000 = Test-NetConnection -ComputerName localhost -Port 3000 -WarningAction SilentlyContinue

if ($port8000.TcpTestSucceeded -or (Get-Process uvicorn -ErrorAction SilentlyContinue)) {
    Write-Host "✓ 后端服务可访问 (8000)" -ForegroundColor Green
} else {
    Write-Host "ℹ️  后端服务未运行（这是正常的，现在启动它）" -ForegroundColor Cyan
}

Write-Host ""
Write-Host "准备就绪！按照上面的步骤启动服务..." -ForegroundColor Green
