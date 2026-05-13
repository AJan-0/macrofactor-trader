"""
services/okx_client.py
OKX V5 REST API 异步客户端 —— 带缓存加速 + 降级机制。

使用 httpx.AsyncClient 进行非阻塞 HTTP 请求，避免阻塞 FastAPI 的事件循环。
OKX 官方文档: https://www.okx.com/docs-v5/en/#rest-api-market-data-get-candlesticks

缓存集成:
    - 模块级 _cache_instance 由 main.py lifespan 注入。
    - get_crypto_klines_cached() 对外暴露，内部自动处理缓存读写。
    - OKX API 故障时返回上次成功的缓存数据（即使已过期）。
"""

import httpx
import logging
from typing import Any, TYPE_CHECKING

from models import KlineData

if TYPE_CHECKING:
    from services.cache_backends import ICacheBackend

logger = logging.getLogger(__name__)

# ──────────────────────────────
# 熔断器（可选依赖）
# ──────────────────────────────

try:
    from pybreaker import CircuitBreaker
    _okx_breaker = CircuitBreaker(fail_max=5, reset_timeout=30)
except ImportError:
    class _DummyBreaker:
        def __call__(self, func):
            return func
    _okx_breaker = _DummyBreaker()  # type: ignore[assignment]

# ──────────────────────────────
# 常量配置
# ──────────────────────────────

_OKX_BASE_URL: str = "https://www.okx.com"
_DEFAULT_TIMEOUT: httpx.Timeout = httpx.Timeout(10.0, connect=5.0)
_MAX_RESULTS: int = 300  # OKX 单页最大条数

# 模块级复用 AsyncClient（连接池）
_okx_client: httpx.AsyncClient | None = None


def get_okx_client() -> httpx.AsyncClient:
    """获取（或创建）模块级复用的 AsyncClient 实例。"""
    global _okx_client
    if _okx_client is None:
        limits = httpx.Limits(max_connections=20, max_keepalive_connections=10)
        _okx_client = httpx.AsyncClient(
            timeout=_DEFAULT_TIMEOUT,
            limits=limits,
            http2=False,  # OKX 暂不支持 HTTP/2
        )
        logger.info("OKX AsyncClient created (connection pool)")
    return _okx_client


async def close_okx_client() -> None:
    """关闭 AsyncClient，释放连接池资源。应在应用 shutdown 时调用。"""
    global _okx_client
    if _okx_client is not None:
        await _okx_client.aclose()
        _okx_client = None
        logger.info("OKX AsyncClient closed")


class OKXClientError(Exception):
    """OKX API 调用异常基类。"""
    pass


class OKXRequestError(OKXClientError):
    """HTTP 请求层异常（网络超时、DNS 失败等）。"""
    pass


class OKXAPIError(OKXClientError):
    """OKX 返回的业务错误（code != 0）。"""
    def __init__(self, code: str, msg: str) -> None:
        self.code = code
        self.msg = msg
        super().__init__(f"OKX API error [{code}]: {msg}")


# ──────────────────────────────
# 数据转换
# ──────────────────────────────

def _raw_row_to_kline(row: list[Any]) -> KlineData:
    """将 OKX 返回的单条原始数据映射为 KlineData。

    OKX /api/v5/market/candles 返回字段顺序:
        [ts, o, h, l, c, vol, volCcy, volCcyQuote, confirm]

    其中 ts 为 Unix 时间戳（毫秒级，13 位），需转换为秒级（10 位）。
    """
    try:
        ts_ms: int = int(row[0])  # 毫秒级时间戳
        ts_s: int = ts_ms // 1000  # 转换为秒级
        return KlineData(
            time=ts_s,
            open=float(row[1]),
            high=float(row[2]),
            low=float(row[3]),
            close=float(row[4]),
            volume=float(row[5]),
        )
    except (IndexError, ValueError, TypeError) as exc:
        logger.warning("Skip malformed K-line row %s: %s", row, exc)
        raise OKXClientError(f"Cannot parse row {row}: {exc}") from exc


def _parse_klines_response(raw_data: list[list[Any]]) -> list[KlineData]:
    """将 OKX 返回的原始二维数组解析为 KlineData 列表。"""
    klines: list[KlineData] = []
    for row in raw_data:
        try:
            klines.append(_raw_row_to_kline(row))
        except OKXClientError:
            continue  # 跳过脏数据，保证健壮性
    # 按时间升序排列（OKX 默认返回时间降序）
    klines.sort(key=lambda k: k.time)
    return klines


# ──────────────────────────────
# 核心请求函数
# ──────────────────────────────

@_okx_breaker
async def get_crypto_klines(
    inst_id: str,
    bar: str = "1D",
    limit: int = 100,
) -> list[KlineData]:
    """异步获取 OKX 加密货币 K 线数据。

    Args:
        inst_id: 交易对 ID，如 "BTC-USDT"。
        bar: K 线粒度，如 "1D", "4H", "1H"。
        limit: 返回条数，最大 300。

    Returns:
        按时间升序排列的 KlineData 列表。

    Raises:
        OKXRequestError: HTTP 请求失败（网络超时、连接错误等）。
        OKXAPIError: OKX 返回业务错误码（code != 0）。
    """
    url: str = f"{_OKX_BASE_URL}/api/v5/market/candles"
    params: dict[str, str] = {
        "instId": inst_id,
        "bar": bar,
        "limit": str(min(limit, _MAX_RESULTS)),
    }

    client = get_okx_client()
    try:
        response: httpx.Response = await client.get(url, params=params)
        response.raise_for_status()
    except httpx.HTTPStatusError as exc:
        logger.error(
            "OKX HTTP error: status=%s, url=%s, response=%s",
            exc.response.status_code,
            exc.request.url,
            exc.response.text[:500],
        )
        raise OKXRequestError(
            f"OKX HTTP {exc.response.status_code}: {exc.response.text[:200]}"
        ) from exc
    except httpx.RequestError as exc:
        logger.error("OKX network error: %s", exc)
        raise OKXRequestError(f"Network error: {exc}") from exc

    # 解析 JSON
    try:
        payload: dict[str, Any] = response.json()
    except Exception as exc:
        logger.error("OKX JSON decode error: %s", exc)
        raise OKXRequestError(f"Invalid JSON response: {exc}") from exc

    # 检查 OKX 业务码
    if str(payload.get("code", "")) != "0":
        code: str = str(payload.get("code", "unknown"))
        msg: str = str(payload.get("msg", "unknown error"))
        logger.error("OKX business error: code=%s, msg=%s", code, msg)
        raise OKXAPIError(code, msg)

    raw_data: list[list[Any]] = payload.get("data", [])
    if not raw_data:
        logger.warning("OKX returned empty data for %s %s", inst_id, bar)
        return []

    klines = _parse_klines_response(raw_data)
    logger.info(
        "Fetched %d K-lines for %s (%s)",
        len(klines),
        inst_id,
        bar,
    )
    return klines


# ──────────────────────────────
# 缓存集成层（Step 9 新增）
# ──────────────────────────────

# 模块级缓存实例，由 main.py lifespan 注入
_cache_instance: "ICacheBackend | None" = None


def set_cache_backend(cache: "ICacheBackend | None") -> None:
    """注入缓存后端实例（在应用启动时调用）。"""
    global _cache_instance
    _cache_instance = cache
    logger.info("Cache backend injected: %s", type(cache).__name__ if cache else "None")


async def get_crypto_klines_cached(
    inst_id: str,
    bar: str = "1D",
    limit: int = 100,
) -> tuple[list[KlineData], dict[str, Any]]:
    """带缓存加速的 K 线获取（对外暴露接口）。

    策略:
        1. 构建缓存键，优先读取缓存。
        2. 缓存命中 → 直接返回（< 1ms）。
        3. 缓存未命中 → 调用 OKX API。
        4. OKX 成功 → 写入缓存（TTL 按 bar 粒度）→ 返回数据。
        5. OKX 失败 → 尝试返回 stale 缓存（降级）→ 仍失败才抛异常。

    Args:
        inst_id: 交易对 ID，如 "BTC-USDT"。
        bar: K 线粒度。
        limit: 返回条数。

    Returns:
        (klines, meta) —— klines 为数据列表，meta 包含缓存状态信息:
            - cached: bool — 是否命中缓存
            - stale: bool — 是否为降级旧数据
            - source: str — "cache" / "okx" / "cache_stale"
            - latency_ms: int — 近似延迟（毫秒）
    """
    from services.cache_config import cache_settings

    cache = _cache_instance
    cache_key = cache_settings.build_key(inst_id=inst_id, bar=bar, limit=limit)
    ttl = cache_settings.get_ttl(bar)

    meta: dict[str, Any] = {"cached": False, "stale": False, "source": "okx", "latency_ms": 0}

    # ── 1. 尝试读取缓存 ──
    if cache is not None:
        try:
            cached_raw = await cache.get(cache_key, allow_stale=False)
            if cached_raw is not None:
                # 缓存命中（新鲜数据）
                klines = [KlineData(**item) for item in cached_raw]
                meta["cached"] = True
                meta["source"] = "cache"
                meta["latency_ms"] = 1  # 内存/Redis 读取 < 1ms
                logger.info("Cache HIT: %s (%d klines)", cache_key, len(klines))
                return klines, meta
        except Exception as exc:
            logger.warning("Cache read error (%s), bypassing cache", exc)

    # ── 2. 缓存未命中 → 调用 OKX API ──
    klines: list[KlineData] = []
    okx_error: Exception | None = None

    try:
        klines = await get_crypto_klines(inst_id=inst_id, bar=bar, limit=limit)
    except (OKXRequestError, OKXAPIError) as exc:
        okx_error = exc
        logger.error("OKX API failed (%s), attempting cache fallback", exc)

    # ── 3. OKX 成功 → 写入缓存 ──
    if klines and cache is not None:
        try:
            # 序列化为 dict 列表（Pydantic model_dump 兼容）
            serializable = [k.model_dump() if hasattr(k, "model_dump") else k.__dict__ for k in klines]
            await cache.set(cache_key, serializable, ttl=ttl)
            logger.info("Cache SET: %s (ttl=%ds, %d klines)", cache_key, ttl, len(klines))
        except Exception as exc:
            logger.warning("Cache write error: %s", exc)

    # ── 4. OKX 失败 → 尝试 stale 降级 ──
    if okx_error and cache is not None:
        try:
            stale_raw = await cache.get(cache_key, allow_stale=True)
            if stale_raw is not None:
                klines = [KlineData(**item) for item in stale_raw]
                meta["stale"] = True
                meta["source"] = "cache_stale"
                meta["latency_ms"] = 1
                logger.warning(
                    "Cache STALE fallback: %s (%d klines) — OKX error suppressed",
                    cache_key, len(klines),
                )
                return klines, meta
        except Exception as exc:
            logger.error("Cache stale fallback also failed: %s", exc)

    # ── 5. 既无缓存也无 OKX → 抛异常 ──
    if okx_error:
        raise okx_error  # 重新抛出原始 OKX 异常

    meta["latency_ms"] = 500  # API 请求约 500ms
    return klines, meta
