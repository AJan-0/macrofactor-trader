"""Alert Store — persistence layer for alert configurations.

Stores user-defined alert rules in SQLite via SQLAlchemy.
Supports CRUD operations and cooldown tracking.

Table: alert_configs
    - id:              TEXT PRIMARY KEY (UUID)
    - symbol:          TEXT NOT NULL           e.g. "BTC-USDT"
    - alert_type:      TEXT NOT NULL           "price_cross" | "reversal" | "multi_tf"
    - enabled:         BOOLEAN DEFAULT TRUE
    - params:          JSON NOT NULL           type-specific parameters
    - cooldown_minutes: INTEGER DEFAULT 30
    - created_at:      DATETIME
    - updated_at:      DATETIME
    - last_triggered:  DATETIME NULLABLE
    - trigger_count:   INTEGER DEFAULT 0
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from sqlalchemy import Column, String, Float, Boolean, Integer, DateTime, JSON, select, update, delete
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import declarative_base

# Use app's Base so the table is created along with others
from database import Base


# ──────────────────────────────
# SQLAlchemy Model
# ──────────────────────────────

class AlertConfigModel(Base):
    __tablename__ = "alert_configs"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    symbol = Column(String, nullable=False, index=True)
    alert_type = Column(String, nullable=False)  # price_cross | reversal | multi_tf
    enabled = Column(Boolean, default=True)
    params = Column(JSON, nullable=False)
    cooldown_minutes = Column(Integer, default=30)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    last_triggered = Column(DateTime, nullable=True)
    trigger_count = Column(Integer, default=0)


# ──────────────────────────────
# DTO (lightweight, no ORM deps)
# ──────────────────────────────

class AlertConfigDTO:
    __slots__ = (
        "id", "symbol", "alert_type", "enabled", "params",
        "cooldown_minutes", "created_at", "updated_at",
        "last_triggered", "trigger_count",
    )

    def __init__(
        self,
        id: str,
        symbol: str,
        alert_type: str,
        enabled: bool,
        params: Dict[str, Any],
        cooldown_minutes: int,
        created_at: datetime,
        updated_at: datetime,
        last_triggered: Optional[datetime] = None,
        trigger_count: int = 0,
    ) -> None:
        self.id = id
        self.symbol = symbol
        self.alert_type = alert_type
        self.enabled = enabled
        self.params = params
        self.cooldown_minutes = cooldown_minutes
        self.created_at = created_at
        self.updated_at = updated_at
        self.last_triggered = last_triggered
        self.trigger_count = trigger_count

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "symbol": self.symbol,
            "alert_type": self.alert_type,
            "enabled": self.enabled,
            "params": self.params,
            "cooldown_minutes": self.cooldown_minutes,
            "created_at": self.created_at.isoformat(),
            "updated_at": self.updated_at.isoformat(),
            "last_triggered": self.last_triggered.isoformat() if self.last_triggered else None,
            "trigger_count": self.trigger_count,
        }


def _model_to_dto(m: AlertConfigModel) -> AlertConfigDTO:
    return AlertConfigDTO(
        id=m.id,
        symbol=m.symbol,
        alert_type=m.alert_type,
        enabled=m.enabled,
        params=m.params,
        cooldown_minutes=m.cooldown_minutes,
        created_at=m.created_at,
        updated_at=m.updated_at,
        last_triggered=m.last_triggered,
        trigger_count=m.trigger_count,
    )


# ──────────────────────────────
# CRUD Service
# ──────────────────────────────

class AlertStore:
    """Async CRUD for alert configurations."""

    async def create(self, session: AsyncSession, dto: AlertConfigDTO) -> AlertConfigDTO:
        model = AlertConfigModel(
            id=dto.id or str(uuid.uuid4()),
            symbol=dto.symbol.upper(),
            alert_type=dto.alert_type,
            enabled=dto.enabled,
            params=dto.params,
            cooldown_minutes=dto.cooldown_minutes,
        )
        session.add(model)
        await session.commit()
        await session.refresh(model)
        return _model_to_dto(model)

    async def get_all(self, session: AsyncSession, symbol: Optional[str] = None) -> List[AlertConfigDTO]:
        stmt = select(AlertConfigModel)
        if symbol:
            stmt = stmt.where(AlertConfigModel.symbol == symbol.upper())
        stmt = stmt.order_by(AlertConfigModel.created_at.desc())
        result = await session.execute(stmt)
        models = result.scalars().all()
        return [_model_to_dto(m) for m in models]

    async def get_by_id(self, session: AsyncSession, alert_id: str) -> Optional[AlertConfigDTO]:
        stmt = select(AlertConfigModel).where(AlertConfigModel.id == alert_id)
        result = await session.execute(stmt)
        model = result.scalar_one_or_none()
        return _model_to_dto(model) if model else None

    async def update(self, session: AsyncSession, alert_id: str, updates: Dict[str, Any]) -> Optional[AlertConfigDTO]:
        stmt = (
            update(AlertConfigModel)
            .where(AlertConfigModel.id == alert_id)
            .values(**updates)
        )
        await session.execute(stmt)
        await session.commit()
        # Re-fetch to return updated DTO
        return await self.get_by_id(session, alert_id)

    async def delete(self, session: AsyncSession, alert_id: str) -> bool:
        stmt = delete(AlertConfigModel).where(AlertConfigModel.id == alert_id)
        result = await session.execute(stmt)
        await session.commit()
        return result.rowcount > 0

    async def mark_triggered(self, session: AsyncSession, alert_id: str) -> None:
        now = datetime.now(timezone.utc)
        stmt = (
            update(AlertConfigModel)
            .where(AlertConfigModel.id == alert_id)
            .values(
                last_triggered=now,
                trigger_count=AlertConfigModel.trigger_count + 1,
                updated_at=now,
            )
        )
        await session.execute(stmt)
        await session.commit()