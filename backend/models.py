"""
models.py
全局 Pydantic 数据模型定义。
所有时间戳统一使用 Unix Timestamp (秒级，即 10 位整数)，
与 TradingView Lightweight Charts 的 time 类型保持一致。
"""

from pydantic import BaseModel, Field
from typing import Any, Literal, TypeVar, Generic
from enum import Enum


# ──────────────────────────────
# Enums
# ──────────────────────────────

class AssetSymbol(str, Enum):
    """支持的资产交易对。"""
    BTC_USDT = "BTC-USDT"
    ETH_USDT = "ETH-USDT"
    GC_F = "GC=F"  # Gold Futures (Yahoo Finance)


class Timeframe(str, Enum):
    """K 线时间粒度。
    OKX V5 API 使用以下格式：
      1m, 3m, 5m, 15m, 30m, 1H, 2H, 4H, 6H, 1D, 1W, 1M
    """
    TF_15m = "15m"
    TF_1H = "1H"
    TF_4H = "4H"
    TF_1D = "1D"


# ──────────────────────────────
# K 线数据模型
# ──────────────────────────────

class KlineData(BaseModel):
    """标准 K 线数据结构。

    Attributes:
        time: Unix 时间戳（秒级，10 位整数），对应 K 线开盘时间。
        open: 开盘价。
        high: 最高价。
        low: 最低价。
        close: 收盘价。
        volume: 成交量（标的资产数量）。
    """
    time: int = Field(..., description="Unix timestamp in seconds (10-digit)")
    open: float = Field(..., description="Opening price")
    high: float = Field(..., description="Highest price")
    low: float = Field(..., description="Lowest price")
    close: float = Field(..., description="Closing price")
    volume: float = Field(..., description="Trading volume in base currency")

    model_config = {
        "json_schema_extra": {
            "example": {
                "time": 1746057600,
                "open": 78179.00,
                "high": 79200.50,
                "low": 77850.30,
                "close": 78657.25,
                "volume": 2850.42,
            }
        }
    }


class KlinesResponse(BaseModel):
    """/api/klines 接口的统一返回结构。"""
    symbol: str = Field(..., description="Instrument ID, e.g. BTC-USDT")
    timeframe: str = Field(..., description="Bar size, e.g. 1D")
    count: int = Field(..., description="Number of K-line records returned")
    data: list[KlineData] = Field(default_factory=list)
    source: str = Field(default="OKX", description="Data source name")


# ──────────────────────────────
# 通用响应包装
# ──────────────────────────────

T = TypeVar("T")

class ApiResponse(BaseModel, Generic[T]):
    """统一 API 响应格式（可选，便于前端统一处理）。"""
    code: int = Field(default=200)
    message: str = Field(default="success")
    data: T | None = None


# ──────────────────────────────
# 宏观事件数据模型
# ──────────────────────────────

class EventCategory(str, Enum):
    """宏观事件分类。"""
    Macro = "Macro"
    GeoPolitics = "GeoPolitics"
    CryptoNative = "CryptoNative"


class ImpactLevel(str, Enum):
    """事件影响级别。"""
    High = "high"
    Medium = "medium"
    Low = "low"


class MacroEvent(BaseModel):
    """宏观事件（经济数据 / 地缘政治 / 行业原生事件）。

    设计意图：
        将孤立的经济数据点（如 FRED 利率值）转换为带有
        文字描述、影响评级和时间戳的「事件」对象，
        使其可以直接叠加在 K 线图的时间轴上展示。

    Attributes:
        id: 事件唯一标识（形如 evt-001）。
        timestamp: Unix 时间戳（秒级），用于图表定位。
        date_str: 人类可读的日期字符串，用于展示。
        category: 事件分类枚举。
        title: 事件标题（一句话概括）。
        impact_level: 影响级别枚举（high / medium / low）。
        actual_value: 实际数值（如利率 5.25、CPI 3.2 等）。
        unit: 数值单位（如 "%", "基点", "亿美元"）。
        description: 事件详细描述。
        source_name: 数据来源名称。
        source_url: 数据来源 URL。
    """
    id: str = Field(..., description="Unique event ID, e.g. evt-001")
    timestamp: int = Field(..., description="Unix timestamp in seconds")
    date_str: str = Field(..., description="Human-readable date, e.g. 2024-03-20")
    category: EventCategory = Field(..., description="Event category")
    title: str = Field(..., description="Event title in one sentence")
    impact_level: ImpactLevel = Field(..., description="Impact level: high / medium / low")
    actual_value: float | None = Field(default=None, description="Actual numeric value")
    unit: str = Field(default="", description="Unit of the value, e.g. '%', 'bp'")
    description: str = Field(default="", description="Detailed description")
    source_name: str = Field(default="", description="Data source name")
    source_url: str = Field(default="", description="Data source URL")

    model_config = {
        "json_schema_extra": {
            "example": {
                "id": "evt-001",
                "timestamp": 1710892800,
                "date_str": "2024-03-20",
                "category": "Macro",
                "title": "美联储利率决议：维持 5.25%-5.50%",
                "impact_level": "high",
                "actual_value": 5.50,
                "unit": "%",
                "description": "FOMC 连续第五次维持利率不变，点阵图显示年内降息 3 次预期。",
                "source_name": "FRED",
                "source_url": "https://fred.stlouisfed.org/series/DFF",
            }
        }
    }


class MacroEventsResponse(BaseModel):
    """/api/events 接口的统一返回结构。"""
    count: int = Field(..., description="Number of events returned")
    data: list[MacroEvent] = Field(default_factory=list)
    source: str = Field(default="FRED", description="Data source name")
    is_mock: bool = Field(default=False, description="Whether data is mock/fallback")


AlertType = Literal["price_cross", "reversal", "multi_tf"]
AlertParams = dict[str, Any]


class AlertConfig(BaseModel):
    """用户预警规则配置。"""
    id: str
    symbol: str
    alert_type: AlertType
    enabled: bool = True
    params: AlertParams = Field(default_factory=dict)
    cooldown_minutes: int = Field(default=5, ge=1, le=1440)
    created_at: str
    updated_at: str
    last_triggered: str | None = None
    trigger_count: int = 0


class AlertCreatePayload(BaseModel):
    """创建预警规则的请求体。"""
    symbol: str = Field(..., min_length=1, max_length=32)
    alert_type: AlertType
    params: AlertParams = Field(default_factory=dict)
    cooldown_minutes: int = Field(default=5, ge=1, le=1440)


class AlertUpdatePayload(BaseModel):
    """更新预警规则的请求体。"""
    enabled: bool | None = None
    params: AlertParams | None = None
    cooldown_minutes: int | None = Field(default=None, ge=1, le=1440)


class AlertsResponse(BaseModel):
    """预警规则列表响应。"""
    count: int
    alerts: list[AlertConfig] = Field(default_factory=list)
