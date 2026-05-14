#!/bin/bash
# =============================================================================
# MacroFactor Trader 后端启动脚本
# =============================================================================
# 由 systemd 调用，也可手动运行调试。
# =============================================================================

set -euo pipefail

BACKEND_DIR="/var/www/ajan03.xyz/backend"
VENV_BIN="$BACKEND_DIR/venv/bin"

cd "$BACKEND_DIR"

# 激活虚拟环境
source "$VENV_BIN/activate"

# 设置 PYTHONPATH，确保后端模块能正确导入
export PYTHONPATH="$BACKEND_DIR"

# 生产环境变量（如 .env 文件存在则自动加载）
export ENV="${ENV:-production}"

# 启动 uvicorn
exec "$VENV_BIN/uvicorn" main:app \
    --host 127.0.0.1 \
    --port 8000 \
    --workers 4 \
    --proxy-headers \
    --access-log \
    --error-log
