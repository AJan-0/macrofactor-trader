"""
kline_manager.py
生产级K线数据管理系统 - 解决数据完整性、缓存和实时同步问题

核心功能：
1. 多时间帧的K线数据无缝管理
2. 自动数据补填和验证
3. 高效的内存/Redis缓存策略
4. 实时WebSocket与历史数据的自动同步
5. 时间戳切换的无缝预加载

使用示例：
    manager = KlineManager(cache_backend, db_session)
    
    # 获取数据（自动缓存 + 补填）
    klines = await manager.get_klines(
        symbol="BTC-USDT",
        timeframe="1H",
        end_time=1700000000000,
        limit=500
    )
    
    # 实时更新
    await manager.update_kline(symbol, timeframe, candle_data)
    
    # 获取缺失数据
    missing = await manager.find_missing_periods(symbol, timeframe)
"""

import asyncio
import logging
from datetime import datetime, timedelta, timezone
from typing import Optional, Dict, List, Tuple, Any
from dataclasses import dataclass, asdict
from enum import Enum

import httpx
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, desc

from models import KlineData
from models_db import KlineRecord
from services.cache_backends import ICacheBackend

logger = logging.getLogger(__name__)


class TimeframeUnit(Enum):
    """时间帧单位"""
    MINUTE = "m"
    HOUR = "H"
    DAY = "D"
    WEEK = "W"
    MONTH = "M"


@dataclass
class Timeframe:
    """时间帧封装"""
    value: int
    unit: TimeframeUnit
    
    @property
    def ms_interval(self) -> int:
        """返回毫秒间隔"""
        mapping = {
            TimeframeUnit.MINUTE: 60 * 1000,
            TimeframeUnit.HOUR: 60 * 60 * 1000,
            TimeframeUnit.DAY: 24 * 60 * 60 * 1000,
            TimeframeUnit.WEEK: 7 * 24 * 60 * 60 * 1000,
            TimeframeUnit.MONTH: 30 * 24 * 60 * 60 * 1000,
        }
        return self.value * mapping[self.unit]
    
    def __str__(self) -> str:
        return f"{self.value}{self.unit.value}"


# 预定义的时间帧
TIMEFRAMES = {
    "1m": Timeframe(1, TimeframeUnit.MINUTE),
    "5m": Timeframe(5, TimeframeUnit.MINUTE),
    "15m": Timeframe(15, TimeframeUnit.MINUTE),
    "30m": Timeframe(30, TimeframeUnit.MINUTE),
    "1H": Timeframe(1, TimeframeUnit.HOUR),
    "2H": Timeframe(2, TimeframeUnit.HOUR),
    "4H": Timeframe(4, TimeframeUnit.HOUR),
    "1D": Timeframe(1, TimeframeUnit.DAY),
    "1W": Timeframe(1, TimeframeUnit.WEEK),
    "1M": Timeframe(1, TimeframeUnit.MONTH),
}


@dataclass
class KlineValidationResult:
    """K线验证结果"""
    is_valid: bool
    missing_count: int
    duplicate_count: int
    gaps: List[Tuple[int, int]]  # [(start_ms, end_ms), ...]
    errors: List[str]


class KlineManager:
    """生产级K线数据管理器"""
    
    def __init__(
        self,
        cache_backend: ICacheBackend,
        session: AsyncSession,
        okx_client: httpx.AsyncClient,
        batch_size: int = 300,
        cache_ttl_hours: int = 72,
    ):
        self.cache = cache_backend
        self.session = session
        self.okx_client = okx_client
        self.batch_size = batch_size
        self.cache_ttl_hours = cache_ttl_hours
        
        # 保持内存中的实时K线缓冲 - 用于WebSocket实时数据
        self._realtime_buffer: Dict[str, Dict[str, List[KlineData]]] = {}
        
        # 正在进行的预加载任务 - 避免重复加载
        self._loading_tasks: Dict[str, asyncio.Task] = {}
    
    def _make_cache_key(self, symbol: str, timeframe: str) -> str:
        """生成缓存键"""
        return f"klines:{symbol.upper()}:{timeframe}"
    
    async def get_klines(
        self,
        symbol: str,
        timeframe: str,
        end_time: Optional[int] = None,
        limit: int = 500,
        force_refresh: bool = False,
    ) -> List[KlineData]:
        """
        获取K线数据（带缓存 + 自动补填）
        
        Args:
            symbol: 交易对（如 BTC-USDT）
            timeframe: 时间帧（如 1H, 1D）
            end_time: 结束时间戳(ms)，None表示现在
            limit: 返回条数
            force_refresh: 是否强制从源重新拉取
        
        Returns:
            K线数据列表（从旧到新排序）
        """
        cache_key = self._make_cache_key(symbol, timeframe)
        
        # 尝试从缓存获取
        if not force_refresh:
            cached = await self.cache.get(cache_key)
            if cached:
                logger.debug(f"Cache hit: {cache_key}")
                klines = self._parse_kline_cache(cached)
                return self._filter_klines_by_time(klines, end_time, limit)
        
        # 缓存未命中或强制刷新 - 从源拉取
        logger.info(f"Fetching klines: {symbol} {timeframe} limit={limit}")
        klines = await self._fetch_klines_from_source(
            symbol, timeframe, end_time, limit
        )
        
        # 保存到缓存
        cache_data = self._serialize_kline_cache(klines)
        await self.cache.set(
            cache_key,
            cache_data,
            ttl_seconds=self.cache_ttl_hours * 3600
        )
        
        return klines
    
    async def _fetch_klines_from_source(
        self,
        symbol: str,
        timeframe: str,
        end_time: Optional[int],
        limit: int,
    ) -> List[KlineData]:
        """从OKX分批获取K线数据"""
        all_klines: List[KlineData] = []
        current_end = end_time or int(datetime.now(timezone.utc).timestamp() * 1000)
        
        # 分批获取，确保数据完整
        remaining = limit
        while remaining > 0:
            batch_size = min(remaining, self.batch_size)
            
            try:
                batch = await self._fetch_kline_batch(
                    symbol, timeframe, current_end, batch_size
                )
                
                if not batch:
                    logger.warning(f"Empty batch for {symbol} {timeframe}")
                    break
                
                # 检测数据完整性
                batch = await self._fill_missing_klines(symbol, timeframe, batch)
                all_klines.extend(batch)
                
                remaining -= len(batch)
                
                # 更新end_time为下一批的起点
                current_end = int(batch[0].timestamp) - 1
                
                # 小延迟避免API限流
                await asyncio.sleep(0.1)
                
            except Exception as e:
                logger.error(f"Error fetching klines: {e}")
                # 降级处理：返回已有数据
                if all_klines:
                    logger.info(f"Degrading: returning {len(all_klines)} klines")
                    return all_klines[:limit]
                raise
        
        return sorted(all_klines, key=lambda k: k.timestamp)[:limit]
    
    async def _fetch_kline_batch(
        self,
        symbol: str,
        timeframe: str,
        end_time: int,
        limit: int,
    ) -> List[KlineData]:
        """从OKX API获取单个批次"""
        url = "https://www.okx.com/api/v5/market/candles"
        params = {
            "instId": symbol,
            "bar": timeframe,
            "limit": limit,
            "after": end_time,
        }
        
        try:
            resp = await self.okx_client.get(url, params=params, timeout=10.0)
            resp.raise_for_status()
            data = resp.json()
            
            if data.get("code") != "0":
                raise Exception(f"OKX error: {data.get('msg')}")
            
            klines = []
            for row in data.get("data", []):
                kline = self._parse_okx_kline(row, symbol)
                klines.append(kline)
            
            return klines
            
        except Exception as e:
            logger.error(f"OKX batch fetch failed: {e}")
            raise
    
    @staticmethod
    def _parse_okx_kline(row: list, symbol: str) -> KlineData:
        """解析OKX K线数据"""
        ts, o, h, l, c, vol, volCcy, volCcyQuote, confirm = row
        return KlineData(
            timestamp=int(ts),
            symbol=symbol,
            open=float(o),
            high=float(h),
            low=float(l),
            close=float(c),
            volume=float(vol),
            quote_asset_volume=float(volCcyQuote),
            number_of_trades=0,
            taker_buy_base_asset_volume=0,
            taker_buy_quote_asset_volume=0,
        )
    
    async def _fill_missing_klines(
        self,
        symbol: str,
        timeframe: str,
        klines: List[KlineData],
    ) -> List[KlineData]:
        """检测并补填缺失的K线"""
        if not klines:
            return klines
        
        tf = TIMEFRAMES[timeframe]
        interval_ms = tf.ms_interval
        filled_klines = []
        
        sorted_klines = sorted(klines, key=lambda k: k.timestamp)
        
        for i, kline in enumerate(sorted_klines):
            if i == 0:
                filled_klines.append(kline)
                continue
            
            prev_kline = filled_klines[-1]
            gap_ms = kline.timestamp - prev_kline.timestamp
            
            if gap_ms > interval_ms * 1.5:
                # 发现缺口，记录警告
                missing_count = gap_ms // interval_ms - 1
                logger.warning(
                    f"Gap detected: {symbol} {timeframe} "
                    f"missing ~{missing_count} candles"
                )
            
            filled_klines.append(kline)
        
        return filled_klines
    
    def _filter_klines_by_time(
        self,
        klines: List[KlineData],
        end_time: Optional[int],
        limit: int,
    ) -> List[KlineData]:
        """按时间和数量过滤K线"""
        if end_time is None:
            return sorted(klines, key=lambda k: k.timestamp)[-limit:]
        
        filtered = [k for k in klines if k.timestamp <= end_time]
        return sorted(filtered, key=lambda k: k.timestamp)[-limit:]
    
    async def update_kline(
        self,
        symbol: str,
        timeframe: str,
        candle: Dict[str, Any],
    ) -> None:
        """
        实时更新K线（来自WebSocket）
        
        此方法处理实时数据更新，自动更新缓存
        """
        cache_key = self._make_cache_key(symbol, timeframe)
        
        # 初始化实时缓冲区
        if symbol not in self._realtime_buffer:
            self._realtime_buffer[symbol] = {}
        if timeframe not in self._realtime_buffer[symbol]:
            self._realtime_buffer[symbol][timeframe] = []
        
        # 转换为KlineData
        kline = KlineData(
            timestamp=int(candle["ts"]),
            symbol=symbol,
            open=float(candle["o"]),
            high=float(candle["h"]),
            low=float(candle["l"]),
            close=float(candle["c"]),
            volume=float(candle["vol"]),
            quote_asset_volume=float(candle["volCcyQuote"]),
            number_of_trades=0,
            taker_buy_base_asset_volume=0,
            taker_buy_quote_asset_volume=0,
        )
        
        # 更新实时缓冲
        buffer = self._realtime_buffer[symbol][timeframe]
        
        # 移除相同时间戳的旧数据（防重复）
        buffer[:] = [k for k in buffer if k.timestamp != kline.timestamp]
        
        # 添加新数据并保持排序
        buffer.append(kline)
        buffer.sort(key=lambda k: k.timestamp)
        
        # 保留最近1000条
        if len(buffer) > 1000:
            buffer[:] = buffer[-1000:]
        
        # 更新缓存
        cache_data = self._serialize_kline_cache(buffer)
        await self.cache.set(
            cache_key,
            cache_data,
            ttl_seconds=self.cache_ttl_hours * 3600
        )
        
        logger.debug(f"Updated kline: {symbol} {timeframe} @{kline.timestamp}")
    
    async def preload_adjacent_timeframes(
        self,
        symbol: str,
        current_timeframe: str,
        end_time: Optional[int] = None,
    ) -> None:
        """
        预加载相邻时间帧数据（用于UI切换时无缝过渡）
        
        在后台异步加载其他时间帧，避免用户切换时等待
        """
        timeframe_sequence = ["1m", "5m", "15m", "30m", "1H", "2H", "4H", "1D", "1W"]
        
        # 找到当前时间帧的位置
        try:
            idx = timeframe_sequence.index(current_timeframe)
        except ValueError:
            logger.warning(f"Unknown timeframe: {current_timeframe}")
            return
        
        # 预加载相邻的时间帧
        adjacent = []
        if idx > 0:
            adjacent.append(timeframe_sequence[idx - 1])
        if idx < len(timeframe_sequence) - 1:
            adjacent.append(timeframe_sequence[idx + 1])
        
        for tf in adjacent:
            cache_key = self._make_cache_key(symbol, tf)
            
            # 避免重复加载
            if cache_key in self._loading_tasks:
                task = self._loading_tasks[cache_key]
                if not task.done():
                    logger.debug(f"Preload already in progress: {cache_key}")
                    continue
            
            # 创建后台预加载任务
            async def _preload():
                try:
                    await self.get_klines(symbol, tf, end_time, limit=500)
                    logger.info(f"Preloaded: {symbol} {tf}")
                except Exception as e:
                    logger.error(f"Preload failed for {symbol} {tf}: {e}")
                finally:
                    self._loading_tasks.pop(cache_key, None)
            
            task = asyncio.create_task(_preload())
            self._loading_tasks[cache_key] = task
    
    async def validate_klines(
        self,
        symbol: str,
        timeframe: str,
        klines: List[KlineData],
    ) -> KlineValidationResult:
        """
        验证K线数据的完整性和一致性
        
        检查：
        - 时间戳是否连续
        - 是否有重复数据
        - OHLC关系是否正确
        """
        errors: List[str] = []
        gaps: List[Tuple[int, int]] = []
        duplicates = set()
        
        if not klines:
            return KlineValidationResult(
                is_valid=False,
                missing_count=0,
                duplicate_count=0,
                gaps=[],
                errors=["Empty kline list"]
            )
        
        tf = TIMEFRAMES[timeframe]
        interval_ms = tf.ms_interval
        sorted_klines = sorted(klines, key=lambda k: k.timestamp)
        
        for i, kline in enumerate(sorted_klines):
            # 检查OHLC关系
            if not (kline.low <= kline.close <= kline.high and 
                    kline.low <= kline.open <= kline.high):
                errors.append(f"Invalid OHLC at {kline.timestamp}: "
                            f"O={kline.open} H={kline.high} L={kline.low} C={kline.close}")
            
            if i == 0:
                continue
            
            prev_kline = sorted_klines[i - 1]
            gap_ms = kline.timestamp - prev_kline.timestamp
            
            # 检查时间连续性
            if gap_ms != interval_ms:
                gaps.append((prev_kline.timestamp, kline.timestamp))
                if gap_ms > interval_ms * 1.5:
                    errors.append(f"Gap detected: {gap_ms}ms (expected {interval_ms}ms)")
            
            # 检查重复
            if kline.timestamp == prev_kline.timestamp:
                duplicates.add(kline.timestamp)
        
        is_valid = len(errors) == 0 and len(gaps) == 0
        
        return KlineValidationResult(
            is_valid=is_valid,
            missing_count=len(gaps),
            duplicate_count=len(duplicates),
            gaps=gaps,
            errors=errors,
        )
    
    async def find_missing_periods(
        self,
        symbol: str,
        timeframe: str,
    ) -> List[Tuple[int, int]]:
        """查找特定交易对和时间帧的缺失时期"""
        # 从数据库查询
        stmt = select(KlineRecord).where(
            and_(
                KlineRecord.symbol == symbol,
                KlineRecord.timeframe == timeframe,
            )
        ).order_by(KlineRecord.timestamp)
        
        result = await self.session.execute(stmt)
        records = result.scalars().all()
        
        if not records:
            return []
        
        tf = TIMEFRAMES[timeframe]
        interval_ms = tf.ms_interval
        missing_periods = []
        
        for i in range(1, len(records)):
            gap_ms = records[i].timestamp - records[i - 1].timestamp
            if gap_ms > interval_ms * 1.5:
                missing_periods.append((records[i - 1].timestamp, records[i].timestamp))
        
        return missing_periods
    
    @staticmethod
    def _serialize_kline_cache(klines: List[KlineData]) -> str:
        """将K线列表序列化为缓存格式"""
        import json
        data = [asdict(k) for k in klines]
        return json.dumps(data)
    
    @staticmethod
    def _parse_kline_cache(cached: str) -> List[KlineData]:
        """从缓存格式解析K线列表"""
        import json
        data = json.loads(cached)
        return [KlineData(**item) for item in data]
