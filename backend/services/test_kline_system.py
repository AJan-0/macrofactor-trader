"""
test_kline_system.py
K线系统完整测试和验证脚本

测试覆盖：
1. K线管理器
2. 缓存系统
3. 同步引擎
4. 数据验证
5. 性能指标
"""

import asyncio
import json
import logging
import time
from datetime import datetime, timedelta, timezone

import httpx
import pytest
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker

# 配置日志
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger(__name__)


# ============================================================================
# 测试数据和工具
# ============================================================================

def create_mock_kline(ts: int, o: float, h: float, l: float, c: float) -> dict:
    """创建模拟K线数据"""
    return {
        "ts": str(ts),
        "o": str(o),
        "h": str(h),
        "l": str(l),
        "c": str(c),
        "vol": "1000",
        "volCcyQuote": "50000",
    }


def create_kline_sequence(
    start_ts: int,
    interval_ms: int,
    count: int,
    base_price: float = 100.0,
) -> list[dict]:
    """创建K线序列"""
    klines = []
    for i in range(count):
        ts = start_ts + i * interval_ms
        price = base_price + (i % 10) * 0.5
        kline = create_mock_kline(
            ts=ts,
            o=price,
            h=price + 1.0,
            l=price - 0.5,
            c=price + 0.3,
        )
        klines.append(kline)
    return klines


# ============================================================================
# 缓存系统测试
# ============================================================================

@pytest.mark.asyncio
async def test_l1_memory_cache():
    """测试L1内存缓存"""
    from services.advanced_cache import LRUMemoryCache

    cache = LRUMemoryCache(max_size_mb=10)

    # 测试基本操作
    await cache.set("key1", {"data": "value1"}, ttl_seconds=60)
    value = await cache.get("key1")
    assert value == {"data": "value1"}

    # 测试LRU淘汰
    for i in range(100):
        await cache.set(f"key{i}", {"data": f"value{i}"})

    metrics = cache.get_metrics()
    assert metrics["hits"] >= 1
    logger.info(f"L1 Cache Metrics: {metrics}")


@pytest.mark.asyncio
async def test_hybrid_cache():
    """测试混合缓存系统"""
    from services.advanced_cache import HybridCache, LRUMemoryCache

    cache = HybridCache(l1=LRUMemoryCache(max_size_mb=10))

    # 测试写入
    test_data = {"klines": [1, 2, 3, 4, 5]}
    await cache.set("test_key", test_data)

    # 测试读取
    result = await cache.get("test_key")
    assert result == test_data

    # 测试存在检查
    exists = await cache.exists("test_key")
    assert exists is True

    logger.info("Hybrid cache test passed")


# ============================================================================
# K线管理器测试
# ============================================================================

@pytest.mark.asyncio
async def test_kline_validator():
    """测试K线验证器"""
    from services.kline_manager import KlineManager
    from models import KlineData

    # 有效的K线
    valid_kline = KlineData(
        timestamp=1700000000000,
        symbol="BTC-USDT",
        open=100.0,
        high=105.0,
        low=95.0,
        close=102.0,
        volume=1000,
        quote_asset_volume=102000,
        number_of_trades=100,
        taker_buy_base_asset_volume=500,
        taker_buy_quote_asset_volume=51000,
    )

    valid_klines = [valid_kline]
    result = await KlineManager.validate_klines(
        manager=None,
        symbol="BTC-USDT",
        timeframe="1H",
        klines=valid_klines,
    )

    assert result.is_valid is True
    assert len(result.errors) == 0

    # 无效的K线 (OHLC关系不对)
    invalid_kline = KlineData(
        timestamp=1700000000000,
        symbol="BTC-USDT",
        open=100.0,
        high=95.0,  # 高 < 低，不合理
        low=105.0,
        close=102.0,
        volume=1000,
        quote_asset_volume=102000,
        number_of_trades=100,
        taker_buy_base_asset_volume=500,
        taker_buy_quote_asset_volume=51000,
    )

    invalid_klines = [invalid_kline]
    result = await KlineManager.validate_klines(
        manager=None,
        symbol="BTC-USDT",
        timeframe="1H",
        klines=invalid_klines,
    )

    assert result.is_valid is False
    assert len(result.errors) > 0

    logger.info("Kline validator test passed")


# ============================================================================
# 同步引擎测试
# ============================================================================

@pytest.mark.asyncio
async def test_kline_deduplicator():
    """测试K线去重器"""
    from services.kline_sync_engine import KlineDeduplicator, KlineUpdate

    dedup = KlineDeduplicator(max_window=100)

    # 第一条数据
    update1 = KlineUpdate(
        symbol="BTC-USDT",
        timeframe="1H",
        candle={"ts": "1700000000000"},
    )

    is_dup = await dedup.is_duplicate(update1)
    assert is_dup is False  # 第一条不重复

    # 立即发送相同数据
    is_dup = await dedup.is_duplicate(update1)
    assert is_dup is True  # 第二条重复

    # 不同时间戳
    update2 = KlineUpdate(
        symbol="BTC-USDT",
        timeframe="1H",
        candle={"ts": "1700000003600000"},  # 1小时后
    )

    is_dup = await dedup.is_duplicate(update2)
    assert is_dup is False  # 不同时间戳，不重复

    logger.info("Deduplicator test passed")


@pytest.mark.asyncio
async def test_kline_validator_engine():
    """测试同步引擎的数据验证"""
    from services.kline_sync_engine import KlineValidator

    validator = KlineValidator()

    # 有效的数据
    valid_candle = {
        "ts": "1700000000000",
        "o": "100.5",
        "h": "105.2",
        "l": "99.8",
        "c": "102.1",
        "vol": "1000",
        "confirm": "1",
    }

    is_valid, errors = validator.validate_candle(valid_candle)
    assert is_valid is True
    assert len(errors) == 0

    # 无效的数据 (缺失字段)
    invalid_candle = {
        "ts": "1700000000000",
        "o": "100.5",
        # 缺失其他字段
    }

    is_valid, errors = validator.validate_candle(invalid_candle)
    assert is_valid is False
    assert len(errors) > 0

    logger.info("Validator engine test passed")


@pytest.mark.asyncio
async def test_sync_engine():
    """测试完整的同步引擎"""
    from services.kline_sync_engine import KlineSyncEngine, KlineUpdate

    engine = KlineSyncEngine(
        max_buffer_size=1000,
        validation_enabled=True,
        deduplication_enabled=True,
    )

    # 添加有效的更新
    update = KlineUpdate(
        symbol="BTC-USDT",
        timeframe="1H",
        candle={
            "ts": "1700000000000",
            "o": "100.5",
            "h": "105.2",
            "l": "99.8",
            "c": "102.1",
            "vol": "1000",
        },
    )

    added = await engine.add_update(update)
    assert added is True
    assert engine.metrics.messages_received == 1
    assert engine.metrics.messages_processed == 1

    # 添加重复数据
    added = await engine.add_update(update)
    assert added is False
    assert engine.metrics.messages_duplicated == 1

    # 获取待处理的更新
    pending = await engine.get_pending_updates(max_count=10)
    assert len(pending) == 1

    metrics = engine.get_metrics()
    logger.info(f"Sync Engine Metrics: {json.dumps(metrics, indent=2)}")


# ============================================================================
# 冲突解决测试
# ============================================================================

@pytest.mark.asyncio
async def test_conflict_resolver():
    """测试冲突解决器"""
    from services.kline_sync_engine import ConflictResolver

    resolver = ConflictResolver()

    # 场景1: 一个confirm，一个未confirm
    existing = {"ts": "1700000000000", "o": "100", "c": "102", "vol": "1000", "confirm": "0"}
    incoming = {"ts": "1700000000000", "o": "100", "c": "102", "vol": "1000", "confirm": "1"}

    selected, strategy = resolver.resolve_duplicate_timestamp(existing, incoming)
    assert selected == incoming  # confirm优先
    assert strategy == "confirm_priority"

    # 场景2: 都confirm
    existing = {"ts": "1700000000000", "o": "100", "c": "102", "vol": "1000", "confirm": "1"}
    incoming = {"ts": "1700000000000", "o": "100", "c": "102.5", "vol": "1000", "confirm": "1"}

    selected, strategy = resolver.resolve_duplicate_timestamp(existing, incoming)
    assert selected == incoming  # 最新的
    assert strategy == "latest_preferred"

    # 场景3: 都未confirm
    existing = {"ts": "1700000000000", "o": "100", "c": "102", "vol": "900", "confirm": "0"}
    incoming = {"ts": "1700000000000", "o": "100", "c": "102", "vol": "1000", "confirm": "0"}

    selected, strategy = resolver.resolve_duplicate_timestamp(existing, incoming)
    assert selected == incoming  # 成交量大的
    assert strategy == "higher_volume"

    logger.info("Conflict resolver test passed")


# ============================================================================
# 性能测试
# ============================================================================

@pytest.mark.asyncio
async def test_cache_performance():
    """测试缓存性能"""
    from services.advanced_cache import LRUMemoryCache

    cache = LRUMemoryCache(max_size_mb=256)

    # 创建测试数据
    large_data = {
        "klines": [create_mock_kline(1700000000000 + i * 3600000, 100 + i * 0.1, 105 + i * 0.1, 95 + i * 0.1, 102 + i * 0.1)
                   for i in range(500)]
    }

    # 性能测试：写入
    write_start = time.time()
    for i in range(100):
        await cache.set(f"key{i}", large_data)
    write_time = time.time() - write_start

    # 性能测试：读取
    read_start = time.time()
    for i in range(100):
        _ = await cache.get(f"key{i}")
    read_time = time.time() - read_start

    metrics = cache.get_metrics()

    logger.info(f"Cache Performance Test:")
    logger.info(f"  Write 100 items: {write_time:.3f}s ({100/write_time:.0f} ops/s)")
    logger.info(f"  Read 100 items: {read_time:.3f}s ({100/read_time:.0f} ops/s)")
    logger.info(f"  L1 Hit Rate: {metrics['hit_rate']:.1%}")


@pytest.mark.asyncio
async def test_sync_engine_throughput():
    """测试同步引擎吞吐量"""
    from services.kline_sync_engine import KlineSyncEngine, KlineUpdate

    engine = KlineSyncEngine(
        max_buffer_size=10000,
        validation_enabled=False,  # 禁用验证以测试纯吞吐
        deduplication_enabled=False,
    )

    # 创建大量更新
    updates = []
    for i in range(1000):
        update = KlineUpdate(
            symbol="BTC-USDT",
            timeframe="1H",
            candle={
                "ts": str(1700000000000 + i * 1000),
                "o": "100",
                "h": "105",
                "l": "99",
                "c": "102",
                "vol": "1000",
            },
        )
        updates.append(update)

    # 性能测试
    start_time = time.time()
    for update in updates:
        await engine.add_update(update)
    elapsed = time.time() - start_time

    throughput = len(updates) / elapsed
    logger.info(f"Sync Engine Throughput: {throughput:.0f} msg/s")

    assert throughput > 1000  # 应该超过1000 msg/s


# ============================================================================
# 集成测试
# ============================================================================

@pytest.mark.asyncio
async def test_full_pipeline():
    """测试完整数据流"""
    from services.advanced_cache import HybridCache, LRUMemoryCache
    from services.kline_sync_engine import KlineSyncEngine, create_sync_pipeline

    # 初始化组件
    cache = HybridCache(l1=LRUMemoryCache())
    sync_engine = KlineSyncEngine()

    # 创建模拟的更新处理器
    processed_updates = []

    async def update_handler(symbol: str, timeframe: str, candle: dict):
        processed_updates.append((symbol, timeframe, candle))

    # 创建同步管道
    pipeline = await create_sync_pipeline(
        sync_engine=sync_engine,
        kline_manager=None,  # 这里可以用实际的manager
        update_callback=update_handler,
    )

    # 发送一些数据
    for i in range(10):
        candle = {
            "ts": str(1700000000000 + i * 3600000),
            "o": "100",
            "h": "105",
            "l": "99",
            "c": "102",
            "vol": "1000",
        }
        await pipeline("BTC-USDT", "1H", candle)
        await asyncio.sleep(0.01)

    # 等待处理
    await asyncio.sleep(0.5)

    logger.info(f"Full Pipeline Test: {len(processed_updates)} updates processed")


# ============================================================================
# 运行测试
# ============================================================================

async def run_all_tests():
    """运行所有测试"""
    logger.info("=" * 80)
    logger.info("K线系统测试开始")
    logger.info("=" * 80)

    tests = [
        ("L1 Memory Cache", test_l1_memory_cache),
        ("Hybrid Cache", test_hybrid_cache),
        ("Kline Validator", test_kline_validator),
        ("Deduplicator", test_kline_deduplicator),
        ("Validator Engine", test_kline_validator_engine),
        ("Sync Engine", test_sync_engine),
        ("Conflict Resolver", test_conflict_resolver),
        ("Cache Performance", test_cache_performance),
        ("Sync Engine Throughput", test_sync_engine_throughput),
        ("Full Pipeline", test_full_pipeline),
    ]

    passed = 0
    failed = 0

    for name, test_func in tests:
        try:
            logger.info(f"\n运行测试: {name}")
            await test_func()
            logger.info(f"✓ {name} 通过")
            passed += 1
        except Exception as e:
            logger.error(f"✗ {name} 失败: {e}")
            failed += 1

    logger.info("\n" + "=" * 80)
    logger.info(f"测试结果: {passed} 通过, {failed} 失败")
    logger.info("=" * 80)

    return failed == 0


if __name__ == "__main__":
    success = asyncio.run(run_all_tests())
    exit(0 if success else 1)
