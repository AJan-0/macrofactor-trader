"""
advanced_cache.py
生产级多层缓存系统 - LRU + 预热 + 失效策略

支持：
1. 内存L1缓存（LRU，带容量限制）
2. Redis L2缓存（分布式，持久化）
3. 预加载和预热机制
4. 缓存命中率统计
5. 自动降级（Redis不可用时回退到内存）

架构：
    应用 ← L1内存缓存(LRU) ← L2Redis缓存 ← 数据源

性能指标:
    - L1命中: 微秒级
    - L2命中: 毫秒级
    - 源查询: 秒级
"""

import asyncio
import json
import logging
import time
from abc import ABC, abstractmethod
from collections import OrderedDict
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional, Tuple, List

import redis.asyncio as redis
from enum import Enum

logger = logging.getLogger(__name__)


class CacheLevel(Enum):
    """缓存层级"""
    L1 = "L1_MEMORY"
    L2 = "L2_REDIS"
    SOURCE = "SOURCE"


@dataclass
class CacheMetrics:
    """缓存性能指标"""
    level: CacheLevel
    hit_count: int = 0
    miss_count: int = 0
    total_size_bytes: int = 0
    last_reset: datetime = None
    
    @property
    def hit_rate(self) -> float:
        """缓存命中率"""
        total = self.hit_count + self.miss_count
        return self.hit_count / total if total > 0 else 0.0
    
    @property
    def avg_size_bytes(self) -> float:
        """平均条目大小"""
        total = self.hit_count + self.miss_count
        return self.total_size_bytes / total if total > 0 else 0.0


class ICacheBackend(ABC):
    """缓存后端接口"""
    
    @abstractmethod
    async def get(self, key: str) -> Optional[Any]:
        """获取缓存"""
        pass
    
    @abstractmethod
    async def set(self, key: str, value: Any, ttl_seconds: int = 3600) -> None:
        """设置缓存"""
        pass
    
    @abstractmethod
    async def delete(self, key: str) -> None:
        """删除缓存"""
        pass
    
    @abstractmethod
    async def exists(self, key: str) -> bool:
        """检查缓存是否存在"""
        pass
    
    @abstractmethod
    async def clear(self) -> None:
        """清空缓存"""
        pass


class LRUMemoryCache(ICacheBackend):
    """
    L1: 内存LRU缓存
    
    特点：
    - 快速访问（微秒级）
    - 自动过期和容量管理
    - 线程安全
    """
    
    def __init__(self, max_size_mb: int = 512):
        self.max_size_bytes = max_size_mb * 1024 * 1024
        self._cache: OrderedDict[str, Tuple[Any, float, int]] = OrderedDict()
        # (value, expiry_time, size_bytes)
        self._lock = asyncio.Lock()
        self._metrics = CacheMetrics(level=CacheLevel.L1)
    
    async def get(self, key: str) -> Optional[Any]:
        """获取值（并更新LRU顺序）"""
        async with self._lock:
            if key in self._cache:
                value, expiry_time, size = self._cache[key]
                
                # 检查过期
                if time.time() > expiry_time:
                    del self._cache[key]
                    self._metrics.miss_count += 1
                    return None
                
                # 移到最后（最近使用）
                self._cache.move_to_end(key)
                self._metrics.hit_count += 1
                logger.debug(f"L1 cache hit: {key}")
                return value
            
            self._metrics.miss_count += 1
            return None
    
    async def set(self, key: str, value: Any, ttl_seconds: int = 3600) -> None:
        """设置值（带LRU淘汰）"""
        async with self._lock:
            # 计算大小
            try:
                size = len(json.dumps(value).encode())
            except:
                size = 1000  # 默认大小
            
            expiry_time = time.time() + ttl_seconds
            self._cache[key] = (value, expiry_time, size)
            self._cache.move_to_end(key)  # 移到最后
            
            # 检查容量并淘汰
            self._evict_if_needed()
            logger.debug(f"L1 cache set: {key} (ttl={ttl_seconds}s)")
    
    async def delete(self, key: str) -> None:
        """删除键"""
        async with self._lock:
            self._cache.pop(key, None)
    
    async def exists(self, key: str) -> bool:
        """检查是否存在"""
        async with self._lock:
            if key in self._cache:
                value, expiry_time, _ = self._cache[key]
                if time.time() > expiry_time:
                    del self._cache[key]
                    return False
                return True
            return False
    
    async def clear(self) -> None:
        """清空所有缓存"""
        async with self._lock:
            self._cache.clear()
    
    def _evict_if_needed(self) -> None:
        """LRU淘汰 - 删除最旧或最大的"""
        current_size = sum(size for _, _, size in self._cache.values())
        
        while current_size > self.max_size_bytes and self._cache:
            # 移除最旧的（先进先出）
            key, (_, _, size) = self._cache.popitem(last=False)
            current_size -= size
            logger.debug(f"L1 evicted: {key}")
    
    def get_metrics(self) -> CacheMetrics:
        """获取指标"""
        self._metrics.total_size_bytes = sum(
            size for _, _, size in self._cache.values()
        )
        return self._metrics


class RedisCache(ICacheBackend):
    """
    L2: Redis分布式缓存
    
    特点：
    - 分布式访问
    - 持久化存储
    - TTL自动过期
    """
    
    def __init__(self, redis_url: str = "redis://localhost:6379/0"):
        self.redis_url = redis_url
        self._redis: Optional[redis.Redis] = None
        self._metrics = CacheMetrics(level=CacheLevel.L2)
        self._connected = False
    
    async def connect(self) -> bool:
        """建立连接"""
        try:
            self._redis = await redis.from_url(
                self.redis_url,
                encoding="utf-8",
                decode_responses=False,
            )
            await self._redis.ping()
            self._connected = True
            logger.info(f"Redis connected: {self.redis_url}")
            return True
        except Exception as e:
            logger.error(f"Redis connection failed: {e}")
            self._connected = False
            return False
    
    async def disconnect(self) -> None:
        """断开连接"""
        if self._redis:
            await self._redis.aclose()
            self._connected = False
    
    async def get(self, key: str) -> Optional[Any]:
        """获取值"""
        if not self._connected:
            return None
        
        try:
            value = await self._redis.get(key)
            if value:
                self._metrics.hit_count += 1
                logger.debug(f"L2 cache hit: {key}")
                return json.loads(value.decode())
            
            self._metrics.miss_count += 1
            return None
        except Exception as e:
            logger.error(f"Redis get failed: {e}")
            return None
    
    async def set(self, key: str, value: Any, ttl_seconds: int = 3600) -> None:
        """设置值"""
        if not self._connected:
            return
        
        try:
            data = json.dumps(value).encode()
            await self._redis.setex(key, ttl_seconds, data)
            logger.debug(f"L2 cache set: {key} (ttl={ttl_seconds}s)")
        except Exception as e:
            logger.error(f"Redis set failed: {e}")
    
    async def delete(self, key: str) -> None:
        """删除键"""
        if not self._connected:
            return
        
        try:
            await self._redis.delete(key)
        except Exception as e:
            logger.error(f"Redis delete failed: {e}")
    
    async def exists(self, key: str) -> bool:
        """检查是否存在"""
        if not self._connected:
            return False
        
        try:
            result = await self._redis.exists(key)
            return result > 0
        except Exception as e:
            logger.error(f"Redis exists failed: {e}")
            return False
    
    async def clear(self) -> None:
        """清空所有缓存"""
        if not self._connected:
            return
        
        try:
            await self._redis.flushdb()
        except Exception as e:
            logger.error(f"Redis flushdb failed: {e}")
    
    def get_metrics(self) -> CacheMetrics:
        """获取指标"""
        return self._metrics


class HybridCache(ICacheBackend):
    """
    L1 + L2 混合缓存系统
    
    流程：
    1. 查询L1（内存）- 微秒级
    2. 未命中则查询L2（Redis）- 毫秒级
    3. L2命中则写入L1
    4. L2也未命中则返回None（调用方应该查询源）
    """
    
    def __init__(
        self,
        l1: Optional[ICacheBackend] = None,
        l2: Optional[ICacheBackend] = None,
    ):
        self.l1 = l1 or LRUMemoryCache(max_size_mb=256)
        self.l2 = l2
        self._write_lock = asyncio.Lock()
    
    async def get(self, key: str) -> Optional[Any]:
        """多层查询"""
        # L1查询
        value = await self.l1.get(key)
        if value is not None:
            return value
        
        # L1未命中，查询L2
        if self.l2:
            value = await self.l2.get(key)
            if value is not None:
                # 写入L1
                await self.l1.set(key, value, ttl_seconds=3600)
                logger.debug(f"Promoted L2→L1: {key}")
                return value
        
        return None
    
    async def set(self, key: str, value: Any, ttl_seconds: int = 3600) -> None:
        """同时写入L1和L2"""
        async with self._write_lock:
            await self.l1.set(key, value, ttl_seconds)
            
            if self.l2:
                await self.l2.set(key, value, ttl_seconds)
    
    async def delete(self, key: str) -> None:
        """从L1和L2删除"""
        await self.l1.delete(key)
        if self.l2:
            await self.l2.delete(key)
    
    async def exists(self, key: str) -> bool:
        """检查L1或L2"""
        if await self.l1.exists(key):
            return True
        if self.l2:
            return await self.l2.exists(key)
        return False
    
    async def clear(self) -> None:
        """清空L1和L2"""
        await self.l1.clear()
        if self.l2:
            await self.l2.clear()
    
    def get_metrics(self) -> Dict[str, CacheMetrics]:
        """获取所有层的指标"""
        metrics = {
            "L1": self.l1.get_metrics() if hasattr(self.l1, 'get_metrics') else None,
        }
        if self.l2 and hasattr(self.l2, 'get_metrics'):
            metrics["L2"] = self.l2.get_metrics()
        return metrics


class CachePrewarmer:
    """缓存预热器 - 启动时预加载热数据"""
    
    def __init__(self, cache: ICacheBackend):
        self.cache = cache
    
    async def preheat_symbols(
        self,
        symbols: List[str],
        timeframes: List[str],
        fetch_func,  # 异步函数：async def fetch_func(symbol, timeframe) -> data
    ) -> Dict[str, int]:
        """预热热交易对的缓存"""
        results = {
            "success": 0,
            "failed": 0,
            "skipped": 0,
        }
        
        for symbol in symbols:
            for timeframe in timeframes:
                cache_key = f"klines:{symbol}:{timeframe}"
                
                # 检查是否已缓存
                exists = await self.cache.exists(cache_key)
                if exists:
                    results["skipped"] += 1
                    continue
                
                try:
                    data = await fetch_func(symbol, timeframe)
                    await self.cache.set(cache_key, data, ttl_seconds=72 * 3600)
                    results["success"] += 1
                    logger.info(f"Prewarmed: {symbol} {timeframe}")
                    
                    # 小延迟避免API限流
                    await asyncio.sleep(0.2)
                except Exception as e:
                    logger.error(f"Preheat failed {symbol} {timeframe}: {e}")
                    results["failed"] += 1
        
        return results
