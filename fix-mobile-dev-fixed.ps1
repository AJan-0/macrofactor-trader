# 蹇€熶慨澶嶇Щ鍔ㄧ杩炴帴闂 (Windows PowerShell)

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "绉诲姩绔繛鎺ュ揩閫熶慨澶?(Windows)" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""

# 1. 鑾峰彇鏈満 IP
Write-Host "1锔忊儯  鑾峰彇鏈満 IP 鍦板潃..." -ForegroundColor Yellow

# 鑾峰彇鎵€鏈?IPv4 鍦板潃锛堟帓闄?127.0.0.1 鍜岃櫄鎷熺綉鍗★級
$ips = @()
$adapters = Get-NetIPConfiguration -InterfaceAlias * -ErrorAction SilentlyContinue | 
    Where-Object { $_.NetAdapter.Status -eq "Up" }

foreach ($adapter in $adapters) {
    if ($adapter.IPv4Address -and $adapter.IPv4Address.IPAddress -ne "127.0.0.1") {
        $ips += $adapter.IPv4Address.IPAddress
    }
}

if ($ips.Count -eq 0) {
    Write-Host "鈿狅笍  鏈壘鍒版湁鏁堢殑 IP 鍦板潃锛岃鎵嬪姩缂栬緫 .env.local" -ForegroundColor Yellow
    $LOCAL_IP = "YOUR_IP"
} else {
    # 浣跨敤绗竴涓湁鏁堢殑 IP
    $LOCAL_IP = $ips[0]
    Write-Host "鉁?鏈満 IP: $LOCAL_IP" -ForegroundColor Green
}

Write-Host ""

# 2. 鍒涘缓鍓嶇 .env.local
Write-Host "2锔忊儯  鍒涘缓鍓嶇鐜鍙橀噺鏂囦欢..." -ForegroundColor Yellow

$env_content = @"
# 绉诲姩绔紑鍙戠幆澧冮厤缃?
VITE_API_URL=http://$LOCAL_IP`:8000
VITE_WS_URL=ws://$LOCAL_IP`:8000
"@

Set-Content -Path ".env.local" -Value $env_content -Encoding UTF8
Write-Host "鉁?.env.local 宸插垱寤? -ForegroundColor Green
Write-Host ""

# 3. 鍒涘缓鍚庣 .env锛堝鏋滀笉瀛樺湪锛?
Write-Host "3锔忊儯  鍒涘缓鍚庣鐜鍙橀噺鏂囦欢..." -ForegroundColor Yellow

if (-Not (Test-Path "backend/.env")) {
    $backend_env_content = @"
# 鍚庣閰嶇疆
ENV=development
CORS_ORIGINS=*
CACHE_BACKEND=memory
DATABASE_URL=sqlite+aiosqlite:///./macrofactor.db
"@
    Set-Content -Path "backend/.env" -Value $backend_env_content -Encoding UTF8
    Write-Host "鉁?backend/.env 宸插垱寤? -ForegroundColor Green
} else {
    Write-Host "鉁?backend/.env 宸插瓨鍦紝璺宠繃" -ForegroundColor Green
}
Write-Host ""

# 4. 鍚姩璇存槑
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "4锔忊儯  鍚姩姝ラ锛? -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""

Write-Host "馃數 缁堢 1 - 鍚姩鍚庣锛? -ForegroundColor Blue
Write-Host "   cd backend"
Write-Host "   python -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload"
Write-Host ""

Write-Host "馃煝 缁堢 2 - 鍚姩鍓嶇锛? -ForegroundColor Green
Write-Host "   npm run dev"
Write-Host ""

Write-Host "馃摫 绉诲姩璁惧璁块棶锛? -ForegroundColor Magenta
Write-Host "   http://$LOCAL_IP`:3000" -ForegroundColor Magenta
Write-Host ""

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""

Write-Host "鈿狅笍  閲嶈鎻愮ず锛? -ForegroundColor Yellow
Write-Host "  鈥?绉诲姩璁惧蹇呴』涓庣數鑴戣繛鎺ュ埌鍚屼竴 WiFi" -ForegroundColor Yellow
Write-Host "  鈥?濡傛灉鐪嬪埌闃茬伀澧欐彁绀猴紝璇峰厑璁歌闂? -ForegroundColor Yellow
Write-Host "  鈥?濡傛灉杩樻槸鏃犳硶杩炴帴锛屾煡鐪?MOBILE_TROUBLESHOOTING.md" -ForegroundColor Yellow
Write-Host ""

# 5. 闃茬伀澧欐鏌?
Write-Host "5锔忊儯  闃茬伀澧欐鏌?.." -ForegroundColor Yellow
$port8000 = Test-NetConnection -ComputerName localhost -Port 8000 -WarningAction SilentlyContinue
$port3000 = Test-NetConnection -ComputerName localhost -Port 3000 -WarningAction SilentlyContinue

if ($port8000.TcpTestSucceeded -or (Get-Process uvicorn -ErrorAction SilentlyContinue)) {
    Write-Host "鉁?鍚庣鏈嶅姟鍙闂?(8000)" -ForegroundColor Green
} else {
    Write-Host "鈩癸笍  鍚庣鏈嶅姟鏈繍琛岋紙杩欐槸姝ｅ父鐨勶紝鐜板湪鍚姩瀹冿級" -ForegroundColor Cyan
}

Write-Host ""
Write-Host "鍑嗗灏辩华锛佹寜鐓т笂闈㈢殑姝ラ鍚姩鏈嶅姟..." -ForegroundColor Green

