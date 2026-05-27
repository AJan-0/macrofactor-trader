"""
models_db.py
SQLAlchemy ORM 模型 — 对应 MacroEvent 的持久化表结构。

设计原则：
    - 字段与 Pydantic MacroEvent 一一对应，确保序列化/反序列化无缝。
    - timestamp + source_name 组成唯一约束，防止重复同步。
    - 支持 Upsert：插入时若冲突则忽略（跳过已存在的数据）。
"""

from sqlalchemy import Boolean, Column, Integer, JSON, String, Float, UniqueConstraint
from sqlalchemy.orm import Mapped

from database import Base


class EventModel(Base):
    """事件数据表。

    Columns:
        id: 自增主键（内部使用）。
        event_id: 业务 ID（如 fred-001, evt-geo-001）。
        timestamp: Unix 时间戳（秒级），用于图表定位 + 唯一约束。
        date_str: 人类可读日期，YYYY-MM-DD。
        category: 分类 — Macro / GeoPolitics / CryptoNative。
        title: 事件标题。
        impact_level: high / medium / low。
        actual_value: 实际数值（可为 NULL）。
        unit: 数值单位。
        description: 详细描述。
        source_name: 数据来源（FRED / Manual 等）。
        source_url: 数据来源 URL。

    UniqueConstraint:
        (timestamp, source_name) — 同一来源同一时间的记录只保留一条。
    """

    __tablename__ = "events"

    # 内部自增主键
    id: Mapped[int] = Column(Integer, primary_key=True, autoincrement=True)

    # 业务字段（与 Pydantic MacroEvent 对应）
    event_id: Mapped[str] = Column(String(32), nullable=False, index=True)
    timestamp: Mapped[int] = Column(Integer, nullable=False, index=True)
    date_str: Mapped[str] = Column(String(16), nullable=False)
    category: Mapped[str] = Column(String(16), nullable=False, index=True)
    title: Mapped[str] = Column(String(256), nullable=False)
    impact_level: Mapped[str] = Column(String(8), nullable=False, index=True)
    actual_value: Mapped[float | None] = Column(Float, nullable=True)
    unit: Mapped[str] = Column(String(16), nullable=False, default="")
    description: Mapped[str] = Column(String(1024), nullable=False, default="")
    source_name: Mapped[str] = Column(String(64), nullable=False, index=True)
    source_url: Mapped[str] = Column(String(512), nullable=False, default="")

    # 唯一约束：同一来源同一时间只存一条
    __table_args__ = (
        UniqueConstraint("timestamp", "source_name", name="uq_event_ts_source"),
    )

    def __repr__(self) -> str:
        return (
            f"<EventModel(id={self.id}, event_id='{self.event_id}', "
            f"ts={self.timestamp}, title='{self.title[:30]}...', "
            f"source='{self.source_name}')>"
        )


class AlertModel(Base):
    """预警规则表。"""

    __tablename__ = "alerts"

    id: Mapped[int] = Column(Integer, primary_key=True, autoincrement=True)
    alert_id: Mapped[str] = Column(String(64), nullable=False, unique=True, index=True)
    symbol: Mapped[str] = Column(String(32), nullable=False, index=True)
    alert_type: Mapped[str] = Column(String(32), nullable=False, index=True)
    enabled: Mapped[bool] = Column(Boolean, nullable=False, default=True, index=True)
    params: Mapped[dict] = Column(JSON, nullable=False, default=dict)
    cooldown_minutes: Mapped[int] = Column(Integer, nullable=False, default=5)
    created_at: Mapped[str] = Column(String(64), nullable=False)
    updated_at: Mapped[str] = Column(String(64), nullable=False)
    last_triggered: Mapped[str | None] = Column(String(64), nullable=True)
    trigger_count: Mapped[int] = Column(Integer, nullable=False, default=0)

    def __repr__(self) -> str:
        return (
            f"<AlertModel(id={self.id}, alert_id='{self.alert_id}', "
            f"symbol='{self.symbol}', type='{self.alert_type}', enabled={self.enabled})>"
        )
