"""
services/cache_backends.py
缓存后端实现 —— MemoryCache（内存 LRU） + RedisCache（redis.asyncio）。

使用方式:
    from services.cache_backends import create_cache_backend
    cache = await create_cache_backend()
    await cache.set("key", value, ttl=300)
    value = await cache.get("key")
    await cache.close()

设计原则:
    - 统一接口 ICacheBackend，两种后端无缝切换。
    - MemoryCache: 零依赖，LRU 淘汰，进程内共享。
    - RedisCache: 生产级，支持分布式，需 REDIS_URL。
    - 两者都支持 TTL + 降级读取（允许返回过期数据）。
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from abc import ABC, abstractmethod
from functools import lru_cache
from typing import Any, Optional

logger = logging.getLogger(__name__)

# ──────────────────────────────
# 抽象接口
# ──────────────────────────────

class ICacheBackend(ABC):
    """缓存后端抽象基类。"""

    @abstractmethod
    async def get(self, key: str, allow_stale: bool = False) -> Any | None:
        """读取缓存值。

        Args:
            key: 缓存键。
            allow_stale: 是否允许返回已过期的缓存（降级模式）。
        Returns:
            缓存值，或 None（未命中）。
        """
        ...

    @abstractmethod
    async def set(self, key: str, value: Any, ttl: int) -> None:
        """写入缓存。

        Args:
            key: 缓存键。
            value: 任意可 JSON 序列化的值。
            ttl: 过期时间（秒）。
        """
        ...

    @abstractmethod
    async def delete(self, key: str) -> None:
        """删除缓存键。"""
        ...

    @abstractmethod
    async def exists(self, key: str) -> bool:
        """检查缓存键是否存在（且未过期）。"""
        ...

    @abstractmethod
    async def close(self) -> None:
        """关闭连接（生命周期结束时调用）。"""
        ...


# ──────────────────────────────
# 方案 A: 内存 LRU 缓存（零依赖）
# ──────────────────────────────

class _MemoryEntry:
    """内存缓存条目，带 TTL 和写入时间戳。"""

    __slots__ = ("value", "stored_at", "ttl")

    def __init__(self, value: Any, ttl: int) -> None:
        self.value = value
        self.stored_at: float = time.time()
        self.ttl: int = ttl

    def is_expired(self) -> bool:
        return time.time() - self.stored_at > self.ttl

    def age(self) -> float:
        return time.time() - self.stored_at


class MemoryCache(ICacheBackend):
    """基于进程内存的 LRU 缓存。

    特点:
        - 零外部依赖，开箱即用。
        - 线程/协程安全（asyncio.Lock 保护）。
        - 固定最大容量，超出时 LRU 淘汰最久未使用的键。
        - 支持 stale 降级读取。

    限制:
        - 进程内共享，多进程部署时不一致。
        - 服务重启数据丢失。
    """

    def __init__(self, maxsize: int = 128) -> None:
        self._store: dict[str, _MemoryEntry] = {}
        self._maxsize = maxsize
        self._lock = asyncio.Lock()
        self._access_order: dict[str, float] = {}  # 用于 LRU：键 → 最后访问时间
        logger.info("MemoryCache initialized | maxsize=%d", maxsize)

    def _enforce_lru(self) -> None:
        """超出容量时淘汰最久未使用的键。"""
        while len(self._store) > self._maxsize:
            oldest_key = min(self._access_order, key=self._access_order.get)  # type: ignore[arg-type]
            self._store.pop(oldest_key, None)
            self._access_order.pop(oldest_key, None)
            logger.debug("MemoryCache LRU evicted: %s", oldest_key)

    def _touch(self, key: str) -> None:
        """更新键的访问时间。"""
        self._access_order[key] = time.time()

    async def get(self, key: str, allow_stale: bool = False) -> Any | None:
        async with self._lock:
            entry = self._store.get(key)
            if entry is None:
                return None

            self._touch(key)

            if not entry.is_expired():
                logger.debug("MemoryCache HIT (fresh): %s", key)
                return entry.value

            # 已过期 —— 根据 allow_stale 决定是否返回
            # ⚠️ 不过期删除条目，保留供 stale fallback 使用
            if allow_stale:
                logger.info("MemoryCache HIT (stale, age=%.0fs): %s", entry.age(), key)
                return entry.value  # 降级返回旧数据

            # 过期且不允许 stale → 视为 miss，但不删除（留给 fallback 使用）
            logger.debug("MemoryCache EXPIRED (not stale-allowed): %s", key)
            return None

    def _cleanup_expired(self) -> int:
        """清理所有过期条目。返回清理数量。"""
        expired_keys = [k for k, v in self._store.items() if v.is_expired()]
        for k in expired_keys:
            self._store.pop(k, None)
            self._access_order.pop(k, None)
        return len(expired_keys)

    async def set(self, key: str, value: Any, ttl: int) -> None:
        async with self._lock:
            # 每次写入时顺便清理过期条目（概率性清理，避免 O(N) 每次触发）
            cleaned = self._cleanup_expired()
            self._store[key] = _MemoryEntry(value, ttl)
            self._touch(key)
            self._enforce_lru()
        if cleaned > 0:
            logger.debug("MemoryCache cleaned %d expired entries", cleaned)
        logger.debug("MemoryCache SET: %s (ttl=%ds)", key, ttl)

    async def delete(self, key: str) -> None:
        async with self._lock:
            self._store.pop(key, None)
            self._access_order.pop(key, None)

    async def exists(self, key: str) -> bool:
        async with self._lock:
            entry = self._store.get(key)
            if entry is None:
                return False
            self._touch(key)
            return not entry.is_expired()

    async def close(self) -> None:
        async with self._lock:
            self._store.clear()
            self._access_order.clear()
        logger.info("MemoryCache closed")


# ──────────────────────────────
# 方案 B: Redis 缓存（生产级）
# ──────────────────────────────

class RedisCache(ICacheBackend):
    """基于 redis.asyncio 的生产级缓存。

    特点:
        - 支持分布式部署，多实例共享缓存。
        - 服务重启数据不丢失。
        - Redis 原生 TTL，自动过期清理。
        - 支持 stale 降级读取（额外存储一份带更长 TTL 的 shadow key）。

    限制:
        - 需要 Redis 服务。
        - 网络往返增加 ~1-3ms 延迟。
    """

    def __init__(self, redis_url: str, stale_extra_ttl: int = 86400) -> None:
        self._redis_url = redis_url
        self._stale_extra_ttl = stale_extra_ttl
        self._client: Any = None  # redis.asyncio.Redis 实例
        self._closed = True

    async def connect(self) -> None:
        """建立 Redis 连接（在 lifespan startup 中调用）。"""
        try:
            import redis.asyncio as aioredis
            self._client = aioredis.from_url(
                self._redis_url,
                encoding="utf-8",
                decode_responses=True,
                socket_connect_timeout=5,
                socket_keepalive=True,
                health_check_interval=30,
            )
            await self._client.ping()
            self._closed = False
            logger.info("RedisCache connected | url=%s", self._redis_url)
        except ImportError:
            logger.error("redis.asyncio not installed. Run: pip install redis")
            raise RuntimeError("redis package required for RedisCache") from None
        except Exception as exc:
            logger.error("Redis connection failed: %s", exc)
            raise

    async def get(self, key: str, allow_stale: bool = False) -> Any | None:
        if self._client is None or self._closed:
            return None
        try:
            raw = await self._client.get(key)
            if raw is not None:
                logger.debug("RedisCache HIT (fresh): %s", key)
                return json.loads(raw)

            # 主 key 不存在 → 尝试读取 stale shadow key
            if allow_stale:
                raw_stale = await self._client.get(f"{key}:stale")
                if raw_stale is not None:
                    logger.info("RedisCache HIT (stale fallback): %s", key)
                    return json.loads(raw_stale)

            logger.debug("RedisCache MISS: %s", key)
            return None
        except Exception as exc:
            logger.warning("RedisCache get error (%s), treating as miss", exc)
            return None

    async def set(self, key: str, value: Any, ttl: int) -> None:
        if self._client is None or self._closed:
            return
        try:
            raw = json.dumps(value, default=str)
            pipe = self._client.pipeline()
            pipe.setex(key, ttl, raw)
            # 同时写入 shadow key，TTL 更长，用于降级
            pipe.setex(f"{key}:stale", ttl + self._stale_extra_ttl, raw)
            await pipe.execute()
            logger.debug("RedisCache SET: %s (ttl=%ds, shadow_ttl=%ds)", key, ttl, ttl + self._stale_extra_ttl)
        except Exception as exc:
            logger.warning("RedisCache set error: %s", exc)

    async def delete(self, key: str) -> None:
        if self._client is None or self._closed:
            return
        try:
            await self._client.delete(key, f"{key}:stale")
        except Exception as exc:
            logger.warning("RedisCache delete error: %s", exc)

    async def exists(self, key: str) -> bool:
        if self._client is None or self._closed:
            return False
        try:
            return bool(await self._client.exists(key))
        except Exception:
            return False

    async def close(self) -> None:
        if self._client and not self._closed:
            await self._client.close()
            self._closed = True
        logger.info("RedisCache closed")


# ──────────────────────────────
# 工厂函数
# ──────────────────────────────

async def create_cache_backend(settings: Any) -> ICacheBackend:
    """根据配置创建对应的缓存后端实例。

    Args:
        settings: CacheSettings 实例（含 backend, redis_url, memory_maxsize 等）。

    Returns:
        已初始化的 ICacheBackend 实例。
    """
    if settings.is_redis():
        cache = RedisCache(settings.redis_url, stale_extra_ttl=settings.stale_max_age)
        await cache.connect()
        return cache
    else:
        return MemoryCache(maxsize=settings.memory_maxsize)
