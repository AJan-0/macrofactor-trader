"""
main.py
FastAPI 应用入口与路由定义 —— v0.3.0 加入 K 线缓存加速层。

启动方式:
    cd /mnt/agents/output/app/backend
    uvicorn main:app --reload --host 0.0.0.0 --port 8000

环境变量:
    CACHE_BACKEND=memory|redis    # 默认 memory（零依赖）
    REDIS_URL=redis://host:6379/0 # redis 模式时使用

Swagger UI:
    http://localhost:8000/docs
"""

import logging
import time
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, HTTPException, Query, Depends, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.ext.asyncio import AsyncSession

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

# ──────────────────────────────
# 日志配置
# ──────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)

# ──────────────────────────────
# 全局状态
# ──────────────────────────────

# 缓存实例（lifespan 中初始化，路由中读取）
_cache: ICacheBackend | None = None


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
    shutdown:
        1. 关闭数据库连接池。
        2. 关闭缓存连接。
    """
    global _cache

    logger.info("=" * 50)
    logger.info("MacroFactor Trader API starting up (v0.3.0)")
    logger.info("Cache backend: %s", cache_settings.backend)
    logger.info("Swagger UI: http://localhost:8000/docs")
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

    # ── 2.5 缓存预热 (v0.3.1 新增) ──
    # 预加载热点K线, 优化启动后首批请求性能
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
        # 同步失败不阻断启动

    yield

    # ── Shutdown ──
    logger.info("MacroFactor Trader API shutting down")
    if _cache is not None:
        await _cache.close()
        logger.info("Cache backend closed")
    await close_db()
    logger.info("Database connections closed")


# ──────────────────────────────
# FastAPI 实例
# ──────────────────────────────

app = FastAPI(
    title="MacroFactor Trader API",
    description="宏观因子与资产价格可视化面板 — 后端服务 (v0.3.0 缓存加速)",
    version="0.3.0",
    lifespan=lifespan,
)

# CORS 配置（开发环境开放，生产环境应收窄）
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-Cache-Status", "X-Cache-Stale"],  # 暴露缓存状态头给前端
)


# ──────────────────────────────
# 健康检查
# ──────────────────────────────

@app.get("/health", tags=["System"])
async def health_check() -> dict[str, Any]:
    """健康检查端点 —— 包含缓存状态。"""
    cache_info = {
        "backend": cache_settings.backend,
        "enabled": _cache is not None,
    }
    # 尝试获取缓存统计
    if hasattr(_cache, "_store"):
        cache_info["memory_keys"] = len(_cache._store)  # type: ignore[union-attr]

    return {
        "status": "ok",
        "service": "macrofactor-trader-api",
        "version": "0.3.0",
        "features": ["klines", "events", "db_persistence", "cache_layer"],
        "cache": cache_info,
    }


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
async def fetch_klines(
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
    """获取 OKX 加密货币 K 线（带缓存加速 + 降级机制）。

    流程:
        1. 检查缓存，命中则直接返回（~1ms）。
        2. 缓存未命中 → 请求 OKX API（~500ms）→ 写入缓存。
        3. OKX 故障 → 返回旧缓存数据（stale fallback）。
        4. 响应头 X-Cache-Status 指示数据来源: HIT / MISS / STALE。
    """
    t0 = time.perf_counter()

    try:
        klines, meta = await get_crypto_klines_cached(
            inst_id=symbol.value,
            bar=timeframe.value,
            limit=limit,
        )
    except OKXRequestError as exc:
        logger.error("Network layer error: %s", exc)
        raise HTTPException(
            status_code=502,
            detail=f"OKX network error: {exc}",
        ) from exc
    except OKXAPIError as exc:
        logger.error("Business layer error: %s", exc)
        raise HTTPException(
            status_code=503,
            detail=f"OKX API error [{exc.code}]: {exc.msg}",
        ) from exc
    except OKXClientError as exc:
        logger.error("Client error: %s", exc)
        raise HTTPException(
            status_code=500,
            detail=f"Unexpected error: {exc}",
        ) from exc

    # 响应头 —— 缓存状态
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
    description="从 SQLite 数据库查询事件（FRED 利率数据 + 静态黑天鹅/地缘/加密事件），按时间戳升序返回。",
)
async def fetch_macro_events(
    category: EventCategory | None = Query(
        default=None,
        description="按分类过滤：Macro / GeoPolitics / CryptoNative",
    ),
    impact: ImpactLevel | None = Query(
        default=None,
        description="按影响级别过滤：high / medium / low",
    ),
    limit: int = Query(
        default=100,
        ge=1,
        le=200,
        description="返回条数上限",
    ),
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
    description="手动清除指定交易对/粒度的 K 线缓存。不传参数则清除全部。",
)
async def clear_cache(
    symbol: str | None = Query(default=None, description="交易对，如 BTC-USDT"),
    timeframe: str | None = Query(default=None, description="粒度，如 1D"),
) -> dict[str, Any]:
    """手动清除缓存。"""
    if _cache is None:
        return {"cleared": False, "reason": "cache not initialized"}

    cleared = 0
    # 简化实现：如果指定了 key 则删除该 key，否则无法批量删除（两种后端不同）
    if symbol and timeframe:
        key = cache_settings.build_key(inst_id=symbol, bar=timeframe, limit=100)
        await _cache.delete(key)
        cleared += 1
    elif hasattr(_cache, "_store"):
        # MemoryCache: 清除所有 klines:* 前缀的键
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
    description="重新从 FRED API 和静态源同步数据到数据库。仅插入新记录，不会重复。",
)
async def trigger_sync() -> dict[str, Any]:
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
        raise HTTPException(
            status_code=500,
            detail=f"Sync failed: {exc}",
        ) from exc


# ──────────────────────────────
# 入口
# ──────────────────────────────

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
