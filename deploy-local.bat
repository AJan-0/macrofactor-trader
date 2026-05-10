@echo off
chcp 65001 >nul
echo ========================================
echo   本地部署辅助脚本
echo ========================================
echo.
echo 请先在 GitHub 创建一个空仓库（不要初始化 README）。
echo.
set /p GITHUB_USER=输入你的 GitHub 用户名: 
set /p REPO_NAME=输入仓库名（如 macrofactor-trader）: 

cd app
git remote remove origin 2>nul
git remote add origin https://github.com/%GITHUB_USER%/%REPO_NAME%.git
git branch -M main
git push -u origin main --force

echo.
echo ========================================
echo   代码已推送到 GitHub！
echo   地址: https://github.com/%GITHUB_USER%/%REPO_NAME%
echo ========================================
echo.
echo 【下一步】
echo 1. 进入 GitHub 仓库 → Settings → Secrets and variables → Actions
echo 2. 添加 3 个 Secret：
echo    - DEPLOY_HOST = 你的阿里云服务器公网IP
echo    - DEPLOY_USER = root
echo    - DEPLOY_KEY  = 服务器上 /var/www/ajan03.xyz/.ssh/deploy_key 的私钥
echo.
pause
