"""Initial migration: create events table

Revision ID: 001
Revises:
Create Date: 2026-05-12 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "events",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("event_id", sa.String(32), nullable=False),
        sa.Column("timestamp", sa.Integer(), nullable=False),
        sa.Column("date_str", sa.String(16), nullable=False),
        sa.Column("category", sa.String(16), nullable=False),
        sa.Column("title", sa.String(256), nullable=False),
        sa.Column("impact_level", sa.String(8), nullable=False),
        sa.Column("actual_value", sa.Float(), nullable=True),
        sa.Column("unit", sa.String(16), nullable=False, default=""),
        sa.Column("description", sa.String(1024), nullable=False, default=""),
        sa.Column("source_name", sa.String(64), nullable=False),
        sa.Column("source_url", sa.String(512), nullable=False, default=""),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("timestamp", "source_name", name="uq_event_ts_source"),
    )
    op.create_index("ix_events_event_id", "events", ["event_id"])
    op.create_index("ix_events_timestamp", "events", ["timestamp"])
    op.create_index("ix_events_category", "events", ["category"])
    op.create_index("ix_events_impact_level", "events", ["impact_level"])
    op.create_index("ix_events_source_name", "events", ["source_name"])


def downgrade() -> None:
    op.drop_index("ix_events_source_name", table_name="events")
    op.drop_index("ix_events_impact_level", table_name="events")
    op.drop_index("ix_events_category", table_name="events")
    op.drop_index("ix_events_timestamp", table_name="events")
    op.drop_index("ix_events_event_id", table_name="events")
    op.drop_table("events")
