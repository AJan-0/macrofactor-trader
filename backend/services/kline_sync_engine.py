"""
kline_sync_engine.py
生产级K线实时同步引擎

核心功能：
1. WebSocket实时数据与历史数据的无缝同步
2. 数据一致性验证和冲突解决
3. 断线自动恢复和数据补填
4. 去重和顺序保证
5. 性能指标收集

数据流：
    OKX WebSocket → 实时缓冲 → 数据验证 → 缓存写入 → 通知客户端
                                  ↓
                           数据库持久化

状态机：
    IDLE → CONNECTING → SYNCED → 运行时更新
                   ↓(失败)
                RECONNECTING
"""

import asyncio
import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Callable, Dict, List, Optional, Set, Any
from collections import deque
import time

logger = logging.getLogger(__name__)


class SyncState(Enum):
    """同步状态"""
    IDLE = "idle"
    CONNECTING = "connecting"
    SYNCED = "synced"
    RECONNECTING = "reconnecting"
    ERROR = "error"


@dataclass
class SyncMetrics:
    """同步性能指标"""
    start_time: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    
    # 计数器
    messages_received: int = 0
    messages_processed: int = 0
    messages_duplicated: int = 0
    messages_failed: int = 0
    
    # 数据一致性
    validation_passed: int = 0
    validation_failed: int = 0
    conflicts_resolved: int = 0
    
    # 连接
    connection_attempts: int = 0
    connection_failures: int = 0
    reconnections: int = 0
    
    # 延迟
    last_message_time: Optional[datetime] = None
    latency_ms: float = 0.0
    avg_latency_ms: float = 0.0
    max_latency_ms: float = 0.0
    
    # 缓冲区
    buffer_size: int = 0
    buffer_overflow_count: int = 0
    
    @property
    def uptime_seconds(self) -> float:
        """运行时间"""
        return (datetime.now(timezone.utc) - self.start_time).total_seconds()
    
    @property
    def messages_per_second(self) -> float:
        """吞吐量"""
        return self.messages_processed / self.uptime_seconds if self.uptime_seconds > 0 else 0
    
    @property
    def success_rate(self) -> float:
        """成功率"""
        total = self.messages_processed + self.messages_failed
        return self.messages_processed / total if total > 0 else 0
    
    @property
    def validation_success_rate(self) -> float:
        """验证成功率"""
        total = self.validation_passed + self.validation_failed
        return self.validation_passed / total if total > 0 else 0


@dataclass
class KlineUpdate:
    """单条K线更新"""
    symbol: str
    timeframe: str
    candle: Dict[str, Any]
    received_time: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    
    def __hash__(self):
        return hash((self.symbol, self.timeframe, self.candle.get("ts")))


class KlineDeduplicator:
    """去重器 - 防止相同数据重复处理"""
    
    def __init__(self, max_window: int = 1000):
        self.max_window = max_window
        self._seen: Dict[str, deque] = {}
        self._lock = asyncio.Lock()
    
    async def is_duplicate(self, update: KlineUpdate) -> bool:
        """检查是否为重复数据"""
        key = f"{update.symbol}|{update.timeframe}|{update.candle.get('ts')}"
        
        async with self._lock:
            if key not in self._seen:
                self._seen[key] = deque([update.received_time])
                return False
            
            # 检查时间窗口内的重复
            window = self._seen[key]
            now = datetime.now(timezone.utc)
            cutoff = now.timestamp() - 60  # 60秒窗口
            
            # 清理过期的
            while window and window[0].timestamp() < cutoff:
                window.popleft()
            
            # 如果在时间窗口内看到过，则为重复
            if len(window) > 0:
                return True
            
            # 记录新的
            window.append(update.received_time)
            
            # 容量管理
            if len(self._seen) > self.max_window * 2:
                # 清理最旧的
                oldest_key = min(self._seen.keys(), 
                               key=lambda k: self._seen[k][-1].timestamp())
                del self._seen[oldest_key]
            
            return False


class KlineValidator:
    """数据验证器"""
    
    @staticmethod
    def validate_candle(candle: Dict[str, Any]) -> Tuple[bool, List[str]]:
        """
        验证单条K线数据的完整性和有效性
        
        Returns:
            (is_valid, error_messages)
        """
        errors = []
        required_fields = ["ts", "o", "h", "l", "c", "vol"]
        
        # 检查必需字段
        for field in required_fields:
            if field not in candle:
                errors.append(f"Missing field: {field}")
        
        if errors:
            return False, errors
        
        try:
            ts = int(candle["ts"])
            o = float(candle["o"])
            h = float(candle["h"])
            l = float(candle["l"])
            c = float(candle["c"])
            vol = float(candle["vol"])
            
            # 验证OHLC关系
            if not (l <= c <= h and l <= o <= h):
                errors.append(f"Invalid OHLC: L={l} O={o} H={h} C={c}")
            
            # 验证价格为正
            if not all(p > 0 for p in [o, h, l, c]):
                errors.append("Price must be positive")
            
            # 验证成交量
            if vol < 0:
                errors.append("Volume cannot be negative")
            
            # 验证时间戳合理性
            now_ms = int(datetime.now(timezone.utc).timestamp() * 1000)
            if ts > now_ms + 60000:  # 允许60秒时钟偏差
                errors.append(f"Timestamp too far in future: {ts}")
            
            return len(errors) == 0, errors
            
        except (ValueError, TypeError) as e:
            errors.append(f"Type conversion error: {e}")
            return False, errors


class KlineSyncEngine:
    """生产级K线同步引擎"""
    
    def __init__(
        self,
        max_buffer_size: int = 5000,
        validation_enabled: bool = True,
        deduplication_enabled: bool = True,
    ):
        self.max_buffer_size = max_buffer_size
        self.validation_enabled = validation_enabled
        self.deduplication_enabled = deduplication_enabled
        
        # 缓冲区
        self._buffer: deque[KlineUpdate] = deque(maxlen=max_buffer_size)
        self._lock = asyncio.Lock()
        
        # 工具
        self.validator = KlineValidator()
        self.deduplicator = KlineDeduplicator()
        
        # 状态
        self.state = SyncState.IDLE
        self.metrics = SyncMetrics()
        
        # 事件处理
        self._handlers: Dict[str, List[Callable]] = {
            "on_update": [],
            "on_sync_complete": [],
            "on_error": [],
            "on_state_change": [],
        }
        
        # 处理任务
        self._processing_task: Optional[asyncio.Task] = None
    
    async def add_update(self, update: KlineUpdate) -> bool:
        """添加一条更新到缓冲区"""
        self.metrics.messages_received += 1
        
        # 去重检查
        if self.deduplication_enabled:
            if await self.deduplicator.is_duplicate(update):
                self.metrics.messages_duplicated += 1
                logger.debug(f"Duplicate message ignored: {update.symbol} {update.timeframe}")
                return False
        
        # 验证
        if self.validation_enabled:
            is_valid, errors = self.validator.validate_candle(update.candle)
            if not is_valid:
                self.metrics.validation_failed += 1
                logger.warning(f"Validation failed: {update.symbol} - {errors}")
                await self._call_handlers("on_error", update, errors)
                return False
            self.metrics.validation_passed += 1
        
        # 添加到缓冲
        async with self._lock:
            try:
                self._buffer.append(update)
                self.metrics.buffer_size = len(self._buffer)
            except IndexError:
                # deque满了，溢出
                self.metrics.buffer_overflow_count += 1
                logger.warning("Buffer overflow - dropping oldest message")
        
        self.metrics.messages_processed += 1
        self.metrics.last_message_time = datetime.now(timezone.utc)
        
        return True
    
    async def get_pending_updates(self, max_count: int = 100) -> List[KlineUpdate]:
        """获取待处理的更新"""
        async with self._lock:
            updates = []
            for _ in range(min(max_count, len(self._buffer))):
                if self._buffer:
                    updates.append(self._buffer.popleft())
            self.metrics.buffer_size = len(self._buffer)
            return updates
    
    async def process_pending(
        self,
        update_handler: Callable[[KlineUpdate], Any],
    ) -> int:
        """
        处理缓冲区中的待更新
        
        Args:
            update_handler: 异步处理函数
        
        Returns:
            处理数量
        """
        updates = await self.get_pending_updates(max_count=1000)
        
        if not updates:
            return 0
        
        processed = 0
        for update in updates:
            try:
                await update_handler(update)
                processed += 1
            except Exception as e:
                self.metrics.messages_failed += 1
                logger.error(f"Error processing update: {e}")
                await self._call_handlers("on_error", update, str(e))
        
        return processed
    
    async def set_state(self, new_state: SyncState) -> None:
        """更新状态"""
        if self.state != new_state:
            old_state = self.state
            self.state = new_state
            logger.info(f"Sync state changed: {old_state.value} → {new_state.value}")
            await self._call_handlers("on_state_change", old_state, new_state)
    
    async def register_handler(
        self,
        event: str,
        handler: Callable,
    ) -> None:
        """注册事件处理器"""
        if event in self._handlers:
            self._handlers[event].append(handler)
            logger.debug(f"Handler registered: {event}")
    
    async def _call_handlers(self, event: str, *args) -> None:
        """调用事件处理器"""
        if event in self._handlers:
            for handler in self._handlers[event]:
                try:
                    if asyncio.iscoroutinefunction(handler):
                        await handler(*args)
                    else:
                        handler(*args)
                except Exception as e:
                    logger.error(f"Handler error ({event}): {e}")
    
    def get_metrics(self) -> Dict[str, Any]:
        """获取性能指标"""
        return {
            "state": self.state.value,
            "uptime_seconds": self.metrics.uptime_seconds,
            "messages_received": self.metrics.messages_received,
            "messages_processed": self.metrics.messages_processed,
            "messages_duplicated": self.metrics.messages_duplicated,
            "messages_failed": self.metrics.messages_failed,
            "messages_per_second": self.metrics.messages_per_second,
            "success_rate": self.metrics.success_rate,
            "validation_success_rate": self.metrics.validation_success_rate,
            "buffer_size": self.metrics.buffer_size,
            "buffer_overflow_count": self.metrics.buffer_overflow_count,
            "validation_passed": self.metrics.validation_passed,
            "validation_failed": self.metrics.validation_failed,
            "conflicts_resolved": self.metrics.conflicts_resolved,
            "avg_latency_ms": self.metrics.avg_latency_ms,
            "max_latency_ms": self.metrics.max_latency_ms,
            "connection_attempts": self.metrics.connection_attempts,
            "reconnections": self.metrics.reconnections,
        }


class ConflictResolver:
    """数据冲突解决器 - 处理同一时间戳的多条数据"""
    
    @staticmethod
    def resolve_duplicate_timestamp(
        existing: Dict[str, Any],
        incoming: Dict[str, Any],
    ) -> Tuple[Dict[str, Any], str]:
        """
        解决相同时间戳的冲突
        
        策略：
        1. 如果confirm标志不同，取confirm=true的
        2. 都confirm则取最新的
        3. 都未confirm则取volume更大的
        
        Returns:
            (selected_candle, conflict_type)
        """
        existing_confirm = existing.get("confirm", "0") == "1"
        incoming_confirm = incoming.get("confirm", "0") == "1"
        
        # 策略1: confirm优先
        if existing_confirm != incoming_confirm:
            selected = existing if existing_confirm else incoming
            return selected, "confirm_priority"
        
        # 策略2: 都confirm则取最新的（靠近当前时间的）
        if existing_confirm and incoming_confirm:
            # 假设最新的arrive_time更近
            return incoming, "latest_preferred"
        
        # 策略3: 都未confirm则取volume更大的
        existing_vol = float(existing.get("vol", 0))
        incoming_vol = float(incoming.get("vol", 0))
        
        if incoming_vol > existing_vol:
            return incoming, "higher_volume"
        
        return existing, "existing_preferred"


async def create_sync_pipeline(
    sync_engine: KlineSyncEngine,
    kline_manager,  # KlineManager instance
    update_callback: Optional[Callable] = None,
) -> Callable:
    """
    创建完整的同步管道处理器
    
    此函数返回一个处理器，可以作为WebSocket的on_update回调
    """
    
    async def _pipeline(symbol: str, timeframe: str, candle: Dict[str, Any]):
        # 1. 创建更新对象
        update = KlineUpdate(symbol, timeframe, candle)
        
        # 2. 添加到缓冲区
        added = await sync_engine.add_update(update)
        if not added:
            return
        
        # 3. 立即处理（不等待）
        async def _process():
            try:
                # 更新KlineManager
                await kline_manager.update_kline(symbol, timeframe, candle)
                
                # 调用自定义回调
                if update_callback:
                    if asyncio.iscoroutinefunction(update_callback):
                        await update_callback(symbol, timeframe, candle)
                    else:
                        update_callback(symbol, timeframe, candle)
                
            except Exception as e:
                logger.error(f"Pipeline processing error: {e}")
        
        # 异步处理，不阻塞WebSocket
        asyncio.create_task(_process())
    
    return _pipeline
