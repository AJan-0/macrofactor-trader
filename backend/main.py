"""
main.py
FastAPI 应用入口与路由定义 —— v0.4.0 加入 OKX WebSocket 实时 K 线推送。

启动方式:
    cd backend
    uvicorn main:app --reload --host 0.0.0.0 --port 8000

环境变量:
    CACHE_BACKEND=memory|redis    # 默认 memory（零依赖）
    REDIS_URL=redis://host:6379/0 # redis 模式时使用

Swagger UI:
    http://localhost:8000/docs

WebSocket 实时 K 线:
    ws://localhost:8000/ws/klines
"""

import asyncio
import contextvars
import json
import logging
import os
import time
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, HTTPException, Query, Depends, Request, Response, WebSocket, WebSocketDisconnect, status
from pythonjsonlogger import jsonlogger
from prometheus_client import Counter, Histogram, Gauge, generate_latest, CONTENT_TYPE_LATEST
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy.ext.asyncio import AsyncSession

try:
    from slowapi import Limiter, _rate_limit_exceeded_handler
    from slowapi.util import get_remote_address
    from slowapi.errors import RateLimitExceeded
    _HAS_SLOWAPI = True
except ImportError:
    _HAS_SLOWAPI = False
    Limiter = None  # type: ignore[misc,assignment]
    _rate_limit_exceeded_handler = None  # type: ignore[misc,assignment]
    RateLimitExceeded = None  # type: ignore[misc,assignment]

from models import (
    AssetSymbol,
    Timeframe,
    KlineData,
    KlinesResponse,
    MacroEvent,
    MacroEventsResponse,
    EventCategory,
    ImpactLevel,
)
from services.okx_client import (
    get_crypto_klines_cached,
    set_cache_backend,
    OKXClientError,
    OKXRequestError,
    OKXAPIError,
)
from services.cache_backends import create_cache_backend, ICacheBackend
from services.cache_config import cache_settings
from database import init_db, close_db, get_db
from services.sync_service import sync_all, query_events_from_db
from services.okx_client import close_okx_client
from config import get_settings

# v0.4.0 新增: OKX WebSocket 实时 K 线推送
from services.okx_ws import OKXWebSocketClient
from services.kline_broadcaster import KlineBroadcaster

# ──────────────────────────────
# 日志配置 (JSON)
# ──────────────────────────────

_request_id_ctx: contextvars.ContextVar[str | None] = contextvars.ContextVar(
    "request_id", default=None
)

class RequestIdFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        record.request_id = _request_id_ctx.get()
        return True

log_handler = logging.StreamHandler()
formatter = jsonlogger.JsonFormatter(
    "%(asctime)s %(levelname)s %(name)s %(message)s",
    rename_fields={"asctime": "timestamp", "levelname": "level"},
    datefmt="%Y-%m-%dT%H:%M:%S%z",
)
log_handler.setFormatter(formatter)
log_handler.addFilter(RequestIdFilter())

logging.basicConfig(
    level=logging.INFO,
    handlers=[log_handler],
)
logger = logging.getLogger(__name__)

# ──────────────────────────────
# 全局状态
# ──────────────────────────────

# 缓存实例（lifespan 中初始化，路由中读取）
_cache: ICacheBackend | None = None

# v0.4.0 新增: 实时 K 线广播
_broadcaster: KlineBroadcaster | None = None
_okx_ws: OKXWebSocketClient | None = None
_okx_ws_task: asyncio.Task | None = None

# ──────────────────────────────
# Prometheus 指标
# ──────────────────────────────

http_requests_total = Counter(
    "http_requests_total",
    "Total HTTP requests",
    ["method", "path", "status"],
)
http_request_duration_seconds = Histogram(
    "http_request_duration_seconds",
    "HTTP request duration in seconds",
    ["method", "path"],
    buckets=[0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0],
)
okx_ws_connected = Gauge(
    "okx_ws_connected",
    "OKX WebSocket connection status (1=connected, 0=disconnected)",
)


# ──────────────────────────────
# 生命周期管理
# ──────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    """应用生命周期钩子。

    startup:
        1. 初始化数据库（创建表结构）。
        2. 初始化缓存后端（Memory 或 Redis）。
        3. 注入缓存到 OKX 客户端。
        4. 执行首次数据同步（FRED + 静态事件）。
        5. [v0.4.0] 启动 OKX WebSocket 实时 K 线推送。
    shutdown:
        1. 停止 OKX WebSocket 连接。
        2. 关闭数据库连接池。
        3. 关闭缓存连接。
    """
    global _cache, _broadcaster, _okx_ws, _okx_ws_task

    logger.info("=" * 50)
    logger.info("MacroFactor Trader API starting up (v0.4.0)")
    logger.info("Cache backend: %s", cache_settings.backend)
    logger.info("Swagger UI: http://localhost:8000/docs")
    logger.info("Kline WS:   ws://localhost:8000/ws/klines")
    logger.info("=" * 50)

    # ── 1. 数据库初始化 ──
    try:
        await init_db()
        logger.info("Database initialized (tables created)")
    except Exception as exc:
        logger.error("Database init failed: %s", exc)
        raise

    # ── 2. 缓存初始化 ──
    try:
        _cache = await create_cache_backend(cache_settings)
        set_cache_backend(_cache)
        logger.info("Cache backend ready: %s", type(_cache).__name__)
    except Exception as exc:
        logger.warning("Cache init failed (%s), running without cache", exc)
        _cache = None

    # ── 2.5 缓存预热 ──
    try:
        from services.cache_warmup import warmup_cache_with_timeout
        warmup_result = await warmup_cache_with_timeout(_cache, timeout_seconds=10.0)
        logger.info(
            "Cache warmup complete | preheated=%d failed=%d total_klines=%d",
            warmup_result["preheated"],
            warmup_result["failed"],
            warmup_result.get("total_klines", 0),
        )
    except Exception as exc:
        logger.warning("Cache warmup error (non-fatal): %s", exc)

    # ── 3. 首次数据同步 ──
    try:
        sync_result = await sync_all()
        fred_in, fred_sk = sync_result["fred"]
        stat_in, stat_sk = sync_result["static"]
        logger.info(
            "Initial sync complete | FRED: %d inserted, %d skipped | "
            "Static: %d inserted, %d skipped",
            fred_in, fred_sk, stat_in, stat_sk,
        )
    except Exception as exc:
        logger.error("Initial sync failed: %s", exc)

    # ── 4. [v0.4.0] OKX WebSocket 实时 K 线推送 ──
    try:
        _broadcaster = KlineBroadcaster()
        _okx_ws = OKXWebSocketClient(on_candle_update=_broadcaster.broadcast_candle)
        _okx_ws_task = asyncio.create_task(_okx_ws.start())
        logger.info("OKX WebSocket task started")
    except Exception as exc:
        logger.warning("OKX WebSocket init failed (non-fatal): %s", exc)
        _broadcaster = None
        _okx_ws = None

    yield

    # ── Shutdown ──
    logger.info("MacroFactor Trader API shutting down")

    # Stop OKX WebSocket
    if _okx_ws is not None:
        await _okx_ws.stop()
        logger.info("OKX WebSocket stopped")
    if _okx_ws_task is not None:
        _okx_ws_task.cancel()
        try:
            await _okx_ws_task
        except asyncio.CancelledError:
            pass

    if _cache is not None:
        await _cache.close()
        logger.info("Cache backend closed")

    # 关闭 OKX HTTP 连接池
    try:
        await close_okx_client()
        logger.info("OKX HTTP client closed")
    except Exception as exc:
        logger.warning("OKX HTTP client close error: %s", exc)

    await close_db()
    logger.info("Database connections closed")


# ──────────────────────────────
# FastAPI 实例
# ──────────────────────────────

# 限流器初始化（如 slowapi 未安装则提供 no-op fallback）
if _HAS_SLOWAPI:
    limiter = Limiter(key_func=get_remote_address)
else:
    class _DummyLimiter:
        def limit(self, _rate: str):
            def decorator(func):
                return func
            return decorator
    limiter = _DummyLimiter()  # type: ignore[assignment]

app = FastAPI(
    title="MacroFactor Trader API",
    description="宏观因子与资产价格可视化面板 — 后端服务 (v0.4.0 实时K线推送)",
    version="0.4.0",
    lifespan=lifespan,
)

if _HAS_SLOWAPI and limiter is not None:
    app.state.limiter = limiter
    app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)  # type: ignore[arg-type]

# CORS 配置（开发环境开放，生产环境必须收紧）
_settings = get_settings()
app.add_middleware(
    CORSMiddleware,
    allow_origins=_settings.cors_origins_list,
    allow_credentials=_settings.cors_origins == "*" or len(_settings.cors_origins_list) > 0,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Request-ID"],
    expose_headers=["X-Cache-Status", "X-Cache-Stale"],
)

# ──────────────────────────────
# 全局中间件 (Prometheus + Request ID)
# ──────────────────────────────

@app.middleware("http")
async def prometheus_and_request_id_middleware(request: Request, call_next):
    request_id = request.headers.get("X-Request-ID", "")
    _request_id_ctx.set(request_id)

    start_time = time.perf_counter()
    response = await call_next(request)
    duration = time.perf_counter() - start_time

    route = request.scope.get("route")
    path = route.path if route else request.url.path
    method = request.method
    status_code = str(response.status_code)

    http_request_duration_seconds.labels(method=method, path=path).observe(duration)
    http_requests_total.labels(method=method, path=path, status=status_code).inc()

    if request_id:
        response.headers["X-Request-ID"] = request_id

    return response

# ──────────────────────────────
# 全局异常处理器
# ──────────────────────────────

@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    logger.exception("Unhandled exception: %s", exc)
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={
            "error": "INTERNAL_ERROR",
            "message": "An unexpected error occurred. Please try again later.",
            "path": str(request.url.path),
        },
    )

@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException) -> JSONResponse:
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "error": f"HTTP_{exc.status_code}",
            "message": exc.detail,
            "path": str(request.url.path),
        },
    )


# ──────────────────────────────
# 管理端点认证依赖
# ──────────────────────────────

async def verify_admin_key(request: Request) -> None:
    settings = get_settings()
    if not settings.admin_key_configured:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Admin API key not configured",
        )
    header_key = request.headers.get("X-Admin-API-Key", "")
    query_key = request.query_params.get("admin_key", "")
    if header_key != settings.admin_api_key and query_key != settings.admin_api_key:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or missing admin API key",
        )


# ──────────────────────────────
# 健康检查
# ──────────────────────────────

@app.get("/health", tags=["System"])
async def health_check() -> dict[str, Any]:
    """健康检查端点 —— 包含缓存和 WebSocket 状态。"""
    cache_info: dict[str, Any] = {
        "backend": cache_settings.backend,
        "enabled": _cache is not None,
    }
    if hasattr(_cache, "_store"):
        cache_info["memory_keys"] = len(_cache._store)  # type: ignore[union-attr]

    ws_info: dict[str, Any] = {
        "okx_connected": _okx_ws.is_connected() if _okx_ws else False,
        "okx_subscriptions": list(_okx_ws._subscriptions) if _okx_ws else [],
        "connected_clients": len(_broadcaster._clients) if _broadcaster else 0,
    }

    return {
        "status": "ok",
        "service": "macrofactor-trader-api",
        "version": "0.4.0",
        "features": ["klines", "events", "db_persistence", "cache_layer", "realtime_ws"],
        "cache": cache_info,
        "websocket": ws_info,
    }


@app.get("/metrics", tags=["System"])
async def metrics() -> Response:
    """Prometheus 指标端点。"""
    connected = 0
    if _okx_ws is not None:
        try:
            connected = 1 if _okx_ws.is_connected() else 0
        except Exception:
            connected = 0
    okx_ws_connected.set(connected)
    return Response(content=generate_latest(), media_type=CONTENT_TYPE_LATEST)


# ──────────────────────────────
# WebSocket 实时 K 线推送 (v0.4.0)
# ──────────────────────────────

@app.websocket("/ws/klines")
async def ws_klines(websocket: WebSocket) -> None:
    """WebSocket 端点: 实时 K 线数据推送。

    协议:
        客户端 → 服务端:
            {"type": "subscribe", "subscriptions": [
                {"symbol": "BTC-USDT", "timeframe": "1H"},
                {"symbol": "ETH-USDT", "timeframe": "15m"}
            ]}

            {"type": "unsubscribe", "subscriptions": [...]}

        服务端 → 客户端:
            {"type": "candle", "symbol": "BTC-USDT", "timeframe": "1H", "candle": {
                "time": 1716000000,
                "open": 65000.5,
                "high": 65100.0,
                "low": 64900.0,
                "close": 65050.0,
                "volume": 123.45,
                "confirm": false,
                "is_new": true,
                "symbol": "BTC-USDT",
                "timeframe": "1H"
            }}

            {"type": "error", "message": "..."}
    """
    if _broadcaster is None or _okx_ws is None:
        await websocket.close(code=1013, reason="Real-time K-line service not available")
        return

    # Accept connection
    client_id = await _broadcaster.connect(websocket)
    logger.info("WS client connected, id=%s", client_id)
    try:
        while True:
            raw = await websocket.receive_text()
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                await _broadcaster.send_error(websocket, "Invalid JSON")
                continue

            msg_type = msg.get("type", "")

            if msg_type == "subscribe":
                subs = msg.get("subscriptions", [])
                if not isinstance(subs, list):
                    await _broadcaster.send_error(websocket, "subscriptions must be an array")
                    continue
                await _broadcaster.update_subscriptions(websocket, subs)
                for sub in subs:
                    symbol = sub.get("symbol")
                    timeframe = sub.get("timeframe")
                    if symbol and timeframe:
                        await _okx_ws.subscribe(symbol, timeframe)
                logger.info("WS client %s subscribed to %d topics", client_id, len(subs))

            elif msg_type == "unsubscribe":
                subs = msg.get("subscriptions", [])
                for sub in subs:
                    symbol = sub.get("symbol")
                    timeframe = sub.get("timeframe")
                    if symbol and timeframe:
                        await _okx_ws.unsubscribe(symbol, timeframe)
                # Remove from client subscriptions
                await _broadcaster.update_subscriptions(websocket, [])
                logger.info("WS client %s unsubscribed", client_id)

            elif msg_type == "ping":
                await websocket.send_text(json.dumps({"type": "pong"}))

            else:
                await _broadcaster.send_error(
                    websocket,
                    f"Unknown message type: {msg_type}. Use 'subscribe' or 'unsubscribe'.",
                )

    except WebSocketDisconnect:
        logger.info("WS client %s disconnected", client_id)
    except Exception as exc:
        logger.warning("WS client %s error: %s", client_id, exc)
    finally:
        await _broadcaster.disconnect(websocket)


# ──────────────────────────────
# K 线数据路由（带缓存加速）
# ──────────────────────────────

@app.get(
    "/api/klines",
    response_model=KlinesResponse,
    tags=["Market Data"],
    summary="获取加密货币 K 线数据（带缓存）",
    description="从 OKX 交易所获取 K 线数据，自动使用缓存加速。首次请求 ~500ms，二次请求 ~1ms。",
)
@limiter.limit("60/minute")
async def fetch_klines(
    request: Request,
    response: Response,
    symbol: AssetSymbol = Query(
        AssetSymbol.BTC_USDT,
        description="交易对，如 BTC-USDT",
    ),
    timeframe: Timeframe = Query(
        Timeframe.TF_1D,
        description="K 线粒度: 1H, 4H, 1D",
    ),
    limit: int = Query(
        100,
        ge=1,
        le=300,
        description="返回条数，最大 300",
    ),
    no_cache: bool = Query(
        False,
        description="强制跳过缓存，直接请求 OKX（用于刷新数据）",
    ),
) -> KlinesResponse:
    """获取 OKX 加密货币 K 线（带缓存加速 + 降级机制）。"""
    t0 = time.perf_counter()

    try:
        klines, meta = await get_crypto_klines_cached(
            inst_id=symbol.value,
            bar=timeframe.value,
            limit=limit,
        )
    except OKXRequestError as exc:
        logger.error("Network layer error: %s", exc)
        raise HTTPException(status_code=502, detail=f"OKX network error: {exc}") from exc
    except OKXAPIError as exc:
        logger.error("Business layer error: %s", exc)
        raise HTTPException(status_code=503, detail=f"OKX API error [{exc.code}]: {exc.msg}") from exc
    except OKXClientError as exc:
        logger.error("Client error: %s", exc)
        raise HTTPException(status_code=500, detail=f"Unexpected error: {exc}") from exc

    cache_source = meta.get("source", "okx")
    response.headers["X-Cache-Status"] = "HIT" if meta.get("cached") else "MISS"
    response.headers["X-Cache-Stale"] = "true" if meta.get("stale") else "false"

    elapsed_ms = int((time.perf_counter() - t0) * 1000)
    source_label = {
        "cache": "Cache",
        "cache_stale": "Cache(stale fallback)",
        "okx": "OKX",
    }.get(cache_source, cache_source)

    logger.info(
        "Klines %s | %s %s limit=%d | %d bars | %dms",
        response.headers["X-Cache-Status"],
        symbol.value, timeframe.value, limit,
        len(klines), elapsed_ms,
    )

    return KlinesResponse(
        symbol=symbol.value,
        timeframe=timeframe.value,
        count=len(klines),
        data=klines,
        source=source_label,
    )


# ──────────────────────────────
# 宏观事件路由（数据库驱动）
# ──────────────────────────────

@app.get(
    "/api/events",
    response_model=MacroEventsResponse,
    tags=["Macro Events"],
    summary="获取宏观经济事件列表（数据库驱动）",
)
@limiter.limit("60/minute")
async def fetch_macro_events(
    request: Request,
    category: EventCategory | None = Query(default=None),
    impact: ImpactLevel | None = Query(default=None),
    limit: int = Query(default=100, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
) -> MacroEventsResponse:
    """获取宏观事件列表（数据库驱动查询）。"""
    cat_str = category.value if category else None
    impact_str = impact.value if impact else None

    events: list[MacroEvent] = await query_events_from_db(
        session=db,
        category=cat_str,
        impact=impact_str,
        limit=limit,
    )

    logger.info(
        "Events query | category=%s impact=%s limit=%d → %d rows",
        cat_str, impact_str, limit, len(events),
    )

    return MacroEventsResponse(
        count=len(events),
        data=events,
        source="SQLite DB",
        is_mock=False,
    )


# ──────────────────────────────
# 缓存管理端点
# ──────────────────────────────

@app.post(
    "/api/cache/clear",
    tags=["Admin"],
    summary="清除 K 线缓存",
    dependencies=[Depends(verify_admin_key)],
)
@limiter.limit("10/minute")
async def clear_cache(
    request: Request,
    symbol: str | None = Query(default=None),
    timeframe: str | None = Query(default=None),
) -> dict[str, Any]:
    """手动清除缓存。"""
    if _cache is None:
        return {"cleared": False, "reason": "cache not initialized"}

    cleared = 0
    if symbol and timeframe:
        key = cache_settings.build_key(inst_id=symbol, bar=timeframe, limit=100)
        await _cache.delete(key)
        cleared += 1
    elif hasattr(_cache, "_store"):
        keys_to_del = [k for k in _cache._store.keys() if k.startswith("klines:")]  # type: ignore[union-attr]
        for k in keys_to_del:
            await _cache.delete(k)
        cleared = len(keys_to_del)

    return {"cleared": True, "keys_removed": cleared}


# ──────────────────────────────
# 同步管理端点
# ──────────────────────────────

@app.post(
    "/api/sync",
    tags=["Admin"],
    summary="手动触发数据同步",
    dependencies=[Depends(verify_admin_key)],
)
@limiter.limit("10/minute")
async def trigger_sync(request: Request) -> dict[str, Any]:
    """手动触发全量数据同步。"""
    try:
        result = await sync_all()
        fred_in, fred_sk = result["fred"]
        stat_in, stat_sk = result["static"]
        return {
            "success": True,
            "fred": {"inserted": fred_in, "skipped": fred_sk},
            "static": {"inserted": stat_in, "skipped": stat_sk},
        }
    except Exception as exc:
        logger.error("Manual sync failed: %s", exc)
        raise HTTPException(status_code=500, detail=f"Sync failed: {exc}") from exc


# ──────────────────────────────
# 入口
# ──────────────────────────────

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
