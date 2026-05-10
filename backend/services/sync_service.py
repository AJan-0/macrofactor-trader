"""
services/sync_service.py
数据同步服务：从 FRED API + 静态源 同步到 SQLite，带 Upsert 逻辑。

核心逻辑：
    1. 检查数据库中是否已存在 (timestamp, source_name) 记录。
    2. 仅插入不存在的记录（跳过重复）。
    3. 静态事件也走同一套 Upsert 逻辑。
"""

import logging
from datetime import datetime, timedelta
from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession

from database import AsyncSessionLocal
from models_db import EventModel
from models import MacroEvent
from services.fred_client import get_fed_rates
from services.mock_events import get_static_events

logger = logging.getLogger(__name__)

# ──────────────────────────────
# Upsert 辅助函数
# ──────────────────────────────

async def _exists(session: AsyncSession, timestamp: int, source_name: str) -> bool:
    """检查数据库中是否已存在 (timestamp, source_name) 记录。"""
    result = await session.execute(
        select(EventModel).where(
            and_(
                EventModel.timestamp == timestamp,
                EventModel.source_name == source_name,
            )
        )
    )
    return result.scalar_one_or_none() is not None


def _macro_to_db(event: MacroEvent) -> EventModel:
    """将 Pydantic MacroEvent 转为 SQLAlchemy EventModel。"""
    return EventModel(
        event_id=event.id,
        timestamp=event.timestamp,
        date_str=event.date_str,
        category=event.category.value if hasattr(event.category, "value") else str(event.category),
        title=event.title,
        impact_level=event.impact_level.value if hasattr(event.impact_level, "value") else str(event.impact_level),
        actual_value=event.actual_value,
        unit=event.unit,
        description=event.description,
        source_name=event.source_name,
        source_url=event.source_url,
    )


# ──────────────────────────────
# 同步函数
# ──────────────────────────────

async def sync_fred_events(
    session: AsyncSession | None = None,
    use_mock: bool = False,
) -> tuple[int, int]:
    """同步 FRED 利率事件到数据库。

    Returns:
        (inserted, skipped) — 插入条数和跳过条数。
    """
    own_session = session is None
    if own_session:
        session = AsyncSessionLocal()

    try:
        fred_events = await get_fed_rates(use_mock=use_mock)
        inserted = 0
        skipped = 0

        for evt in fred_events:
            exists = await _exists(session, evt.timestamp, evt.source_name)
            if exists:
                skipped += 1
                continue

            db_model = _macro_to_db(evt)
            session.add(db_model)
            inserted += 1

        await session.commit()
        logger.info("FRED sync complete: %d inserted, %d skipped", inserted, skipped)
        return inserted, skipped
    except Exception as exc:
        await session.rollback()
        logger.error("FRED sync failed: %s", exc)
        raise
    finally:
        if own_session:
            await session.close()


async def sync_static_events(
    session: AsyncSession | None = None,
) -> tuple[int, int]:
    """同步静态黑天鹅/地缘事件到数据库。

    Returns:
        (inserted, skipped) — 插入条数和跳过条数。
    """
    own_session = session is None
    if own_session:
        session = AsyncSessionLocal()

    try:
        static_events = get_static_events()
        inserted = 0
        skipped = 0

        for evt in static_events:
            exists = await _exists(session, evt.timestamp, evt.source_name)
            if exists:
                skipped += 1
                continue

            db_model = _macro_to_db(evt)
            session.add(db_model)
            inserted += 1

        await session.commit()
        logger.info("Static sync complete: %d inserted, %d skipped", inserted, skipped)
        return inserted, skipped
    except Exception as exc:
        await session.rollback()
        logger.error("Static sync failed: %s", exc)
        raise
    finally:
        if own_session:
            await session.close()


async def sync_all() -> dict[str, tuple[int, int]]:
    """执行全量同步：FRED + 静态事件。

    Returns:
        {"fred": (inserted, skipped), "static": (inserted, skipped)}
    """
    fred_result = await sync_fred_events(use_mock=True)   # 开发环境用 Mock
    static_result = await sync_static_events()
    return {
        "fred": fred_result,
        "static": static_result,
    }


# ──────────────────────────────
# 查询函数（供路由使用）
# ──────────────────────────────

async def query_events_from_db(
    session: AsyncSession,
    category: str | None = None,
    impact: str | None = None,
    limit: int = 200,
) -> list[MacroEvent]:
    """从数据库查询事件，返回 Pydantic MacroEvent 列表。"""
    stmt = select(EventModel)

    if category:
        stmt = stmt.where(EventModel.category == category)
    if impact:
        stmt = stmt.where(EventModel.impact_level == impact)

    stmt = stmt.order_by(EventModel.timestamp.asc()).limit(limit)
    result = await session.execute(stmt)
    rows = result.scalars().all()

    return [_db_to_macro(row) for row in rows]


def _db_to_macro(row: EventModel) -> MacroEvent:
    """将 SQLAlchemy EventModel 转回 Pydantic MacroEvent。"""
    return MacroEvent(
        id=row.event_id,
        timestamp=row.timestamp,
        date_str=row.date_str,
        category=row.category,  # 字符串即可，前端/序列化时处理
        title=row.title,
        impact_level=row.impact_level,
        actual_value=row.actual_value,
        unit=row.unit,
        description=row.description,
        source_name=row.source_name,
        source_url=row.source_url,
    )
