"""
integration_guide.py
生产级K线系统集成指南

此文件展示如何将所有组件集成到FastAPI应用中

集成步骤：
1. 初始化缓存系统（L1内存 + L2 Redis）
2. 初始化K线管理器
3. 初始化同步引擎
4. 注册WebSocket处理
5. 启动预热任务
"""

import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, WebSocket, Query
from sqlalchemy.ext.asyncio import AsyncSession
import httpx

from services.kline_manager import KlineManager, TIMEFRAMES
from services.advanced_cache import (
    HybridCache,
    LRUMemoryCache,
    RedisCache,
    CachePrewarmer,
)
from services.kline_sync_engine import (
    KlineSyncEngine,
    create_sync_pipeline,
)
from services.okx_ws import OKXWebSocketClient
from services.okx_client import get_okx_client, close_okx_client
from database import AsyncSessionLocal
from models import KlineData

logger = logging.getLogger(__name__)


class KlineSystemManager:
    """K线系统总管理器"""

    def __init__(self):
        self.cache: HybridCache | None = None
        self.kline_manager: KlineManager | None = None
        self.sync_engine: KlineSyncEngine | None = None
        self.okx_ws_client: OKXWebSocketClient | None = None
        self.prewarmer: CachePrewarmer | None = None
        self._tasks: list[asyncio.Task] = []

    async def initialize(self, redis_url: str | None = None) -> None:
        """初始化整个系统"""
        logger.info("Initializing Kline System...")

        # 1. 初始化缓存
        self._init_cache(redis_url)

        # 2. 初始化同步引擎
        self.sync_engine = KlineSyncEngine(
            max_buffer_size=5000,
            validation_enabled=True,
            deduplication_enabled=True,
        )
        logger.info("Sync engine initialized")

        # 3. 初始化K线管理器
        async with AsyncSessionLocal() as session:
            self.kline_manager = KlineManager(
                cache_backend=self.cache,
                session=session,
                okx_client=get_okx_client(),
                batch_size=300,
                cache_ttl_hours=72,
            )
        logger.info("Kline manager initialized")

        # 4. 初始化WebSocket客户端
        self._init_okx_ws()

        # 5. 启动预热
        await self._preheat_cache()

    def _init_cache(self, redis_url: str | None = None) -> None:
        """初始化L1+L2混合缓存"""
        # L1: 内存LRU缓存
        l1 = LRUMemoryCache(max_size_mb=512)

        # L2: Redis缓存（如果配置）
        l2 = None
        if redis_url:
            l2 = RedisCache(redis_url)

        # 混合缓存
        self.cache = HybridCache(l1=l1, l2=l2)
        logger.info(f"Cache initialized: L1={l1.__class__.__name__}, L2={l2.__class__.__name__ if l2 else 'None'}")

    def _init_okx_ws(self) -> None:
        """初始化OKX WebSocket客户端"""
        async def on_candle_update(symbol: str, timeframe: str, candle: dict) -> None:
            """处理来自WebSocket的实时K线数据"""
            if self.kline_manager:
                await self.kline_manager.update_kline(symbol, timeframe, candle)

        self.okx_ws_client = OKXWebSocketClient(on_candle_update=on_candle_update)
        logger.info("OKX WebSocket client initialized")

    async def _preheat_cache(self) -> None:
        """预热热交易对的缓存"""
        if not self.cache or not self.kline_manager:
            return

        # 热交易对列表
        hot_symbols = ["BTC-USDT", "ETH-USDT"]
        hot_timeframes = ["1H", "4H", "1D"]

        self.prewarmer = CachePrewarmer(self.cache)

        async def fetch_klines(symbol: str, timeframe: str):
            return await self.kline_manager.get_klines(
                symbol, timeframe, limit=500
            )

        logger.info("Starting cache preheat...")
        results = await self.prewarmer.preheat_symbols(
            hot_symbols, hot_timeframes, fetch_klines
        )
        logger.info(f"Cache preheat results: {results}")

    async def start_realtime_sync(self) -> None:
        """启动实时同步任务"""
        if not self.okx_ws_client:
            return

        # 创建同步管道
        sync_pipeline = await create_sync_pipeline(
            self.sync_engine,
            self.kline_manager,
        )

        # 注册到WebSocket客户端的回调
        self.okx_ws_client.on_candle_update = sync_pipeline

        # 启动WebSocket
        task = asyncio.create_task(self.okx_ws_client.start())
        self._tasks.append(task)

        # 订阅热交易对
        for symbol in ["BTC-USDT", "ETH-USDT"]:
            for timeframe in ["1H", "4H", "1D"]:
                await self.okx_ws_client.subscribe(symbol, timeframe)

        logger.info("Realtime sync started")

    async def shutdown(self) -> None:
        """关闭所有资源"""
        logger.info("Shutting down Kline System...")

        # 关闭WebSocket
        if self.okx_ws_client:
            await self.okx_ws_client.stop()

        # 关闭OKX HTTP客户端
        await close_okx_client()

        # 关闭Redis连接
        if self.cache and hasattr(self.cache, 'l2') and self.cache.l2:
            await self.cache.l2.disconnect()

        # 取消所有任务
        for task in self._tasks:
            if not task.done():
                task.cancel()
                try:
                    await task
                except asyncio.CancelledError:
                    pass

        logger.info("Kline System shutdown complete")

    def get_metrics(self) -> dict:
        """获取系统指标"""
        metrics = {
            "cache": None,
            "sync_engine": None,
        }

        if self.cache:
            metrics["cache"] = self.cache.get_metrics()

        if self.sync_engine:
            metrics["sync_engine"] = self.sync_engine.get_metrics()

        return metrics


# 全局实例
kline_system: KlineSystemManager | None = None


def get_kline_system() -> KlineSystemManager:
    """获取K线系统实例"""
    global kline_system
    if kline_system is None:
        kline_system = KlineSystemManager()
    return kline_system


@asynccontextmanager
async def lifespan(app: FastAPI):
    """FastAPI 生命周期管理"""
    # 启动
    system = get_kline_system()
    await system.initialize(redis_url="redis://localhost:6379/0")
    await system.start_realtime_sync()

    yield

    # 关闭
    await system.shutdown()


# ============================================================================
# FastAPI 路由集成示例
# ============================================================================

async def create_app() -> FastAPI:
    """创建并配置FastAPI应用"""

    app = FastAPI(title="Macrofactor Trader", lifespan=lifespan)

    # ────────────────────────────────────────────────────────────────────────
    # 数据查询接口
    # ────────────────────────────────────────────────────────────────────────

    @app.get("/api/klines")
    async def get_klines(
        symbol: str = Query(..., example="BTC-USDT"),
        timeframe: str = Query(..., example="1H"),
        end_time: int | None = Query(None),
        limit: int = Query(500, ge=1, le=2000),
        force_refresh: bool = Query(False),
    ):
        """
        获取K线数据 - 多层缓存查询

        - **symbol**: 交易对
        - **timeframe**: 时间帧
        - **end_time**: 结束时间戳(ms)
        - **limit**: 返回条数
        - **force_refresh**: 是否强制刷新缓存
        """
        system = get_kline_system()

        try:
            klines = await system.kline_manager.get_klines(
                symbol=symbol,
                timeframe=timeframe,
                end_time=end_time,
                limit=limit,
                force_refresh=force_refresh,
            )

            return {
                "code": 0,
                "msg": "success",
                "data": [k.__dict__ for k in klines],
            }
        except Exception as e:
            logger.error(f"Error fetching klines: {e}")
            return {
                "code": -1,
                "msg": str(e),
                "data": None,
            }

    @app.get("/api/klines/validate")
    async def validate_klines(
        symbol: str = Query(..., example="BTC-USDT"),
        timeframe: str = Query(..., example="1H"),
    ):
        """验证K线数据的完整性"""
        system = get_kline_system()

        try:
            klines = await system.kline_manager.get_klines(
                symbol=symbol, timeframe=timeframe, limit=500
            )

            result = await system.kline_manager.validate_klines(
                symbol, timeframe, klines
            )

            return {
                "code": 0,
                "msg": "success",
                "data": {
                    "is_valid": result.is_valid,
                    "missing_count": result.missing_count,
                    "duplicate_count": result.duplicate_count,
                    "gaps": len(result.gaps),
                    "errors": result.errors[:10],  # 最多返回10个错误
                },
            }
        except Exception as e:
            logger.error(f"Error validating klines: {e}")
            return {
                "code": -1,
                "msg": str(e),
                "data": None,
            }

    @app.get("/api/metrics")
    async def get_metrics():
        """获取系统性能指标"""
        system = get_kline_system()
        return {
            "code": 0,
            "msg": "success",
            "data": system.get_metrics(),
        }

    # ────────────────────────────────────────────────────────────────────────
    # WebSocket 实时推送
    # ────────────────────────────────────────────────────────────────────────

    @app.websocket("/ws/klines")
    async def websocket_klines(websocket: WebSocket):
        """
        WebSocket实时K线推送

        连接后自动接收订阅的交易对的实时K线更新
        """
        system = get_kline_system()
        await websocket.accept()

        subscriptions = set()

        try:
            while True:
                # 接收客户端消息
                data = await websocket.receive_json()
                action = data.get("action")

                if action == "subscribe":
                    symbol = data.get("symbol")
                    timeframe = data.get("timeframe")

                    if symbol and timeframe:
                        subscriptions.add((symbol, timeframe))
                        await system.okx_ws_client.subscribe(symbol, timeframe)
                        await websocket.send_json({
                            "type": "subscribed",
                            "symbol": symbol,
                            "timeframe": timeframe,
                        })

                elif action == "unsubscribe":
                    symbol = data.get("symbol")
                    timeframe = data.get("timeframe")

                    if (symbol, timeframe) in subscriptions:
                        subscriptions.discard((symbol, timeframe))
                        await websocket.send_json({
                            "type": "unsubscribed",
                            "symbol": symbol,
                            "timeframe": timeframe,
                        })

        except Exception as e:
            logger.error(f"WebSocket error: {e}")
        finally:
            await websocket.close()

    # ────────────────────────────────────────────────────────────────────────
    # 管理接口
    # ────────────────────────────────────────────────────────────────────────

    @app.post("/api/admin/cache/clear")
    async def clear_cache():
        """清空所有缓存"""
        system = get_kline_system()
        await system.cache.clear()
        return {
            "code": 0,
            "msg": "Cache cleared",
        }

    @app.post("/api/admin/cache/preheat")
    async def preheat_cache(
        symbols: list[str] | None = None,
        timeframes: list[str] | None = None,
    ):
        """手动预热缓存"""
        system = get_kline_system()

        symbols = symbols or ["BTC-USDT", "ETH-USDT"]
        timeframes = timeframes or ["1H", "4H", "1D"]

        async def fetch_klines(symbol: str, timeframe: str):
            return await system.kline_manager.get_klines(
                symbol, timeframe, limit=500
            )

        results = await system.prewarmer.preheat_symbols(
            symbols, timeframes, fetch_klines
        )

        return {
            "code": 0,
            "msg": "Preheat complete",
            "data": results,
        }

    return app


# ============================================================================
# 使用示例
# ============================================================================

if __name__ == "__main__":
    import uvicorn

    app = asyncio.run(create_app())

    uvicorn.run(
        app,
        host="0.0.0.0",
        port=8000,
        log_level="info",
    )
