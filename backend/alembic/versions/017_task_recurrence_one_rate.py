"""Task recurrence fields + one approved VA rate per client

Revision ID: 017
Revises: 016
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "017"
down_revision: Union[str, None] = "016"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    recurrence = postgresql.ENUM(
        "none", "daily", "weekly", "weekdays", "biweekly", "monthly", "annually", "custom",
        name="task_recurrence",
        create_type=False,
    )
    recurrence.create(op.get_bind(), checkfirst=True)

    op.add_column("tasks", sa.Column("recurrence", recurrence, nullable=False, server_default="none"))
    op.add_column("tasks", sa.Column("recurrence_interval", sa.Integer(), nullable=False, server_default="1"))
    op.add_column("tasks", sa.Column("recurrence_unit", sa.String(16), nullable=True))
    op.add_column("tasks", sa.Column("recurrence_weekdays", postgresql.JSONB(), nullable=True))
    op.add_column("tasks", sa.Column("recurrence_until", sa.Date(), nullable=True))
    op.add_column(
        "tasks",
        sa.Column("series_id", postgresql.UUID(as_uuid=True), nullable=True, index=True),
    )
    op.add_column(
        "tasks",
        sa.Column(
            "parent_task_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("tasks.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )

    # Collapse duplicate approved rates so the unique index can be created
    op.execute(
        """
        WITH ranked AS (
            SELECT id,
                   ROW_NUMBER() OVER (
                       PARTITION BY va_id, client_id
                       ORDER BY reviewed_at DESC NULLS LAST, created_at DESC
                   ) AS rn
            FROM va_rates
            WHERE status = 'approved'
        )
        UPDATE va_rates
        SET status = 'rejected',
            reviewed_at = COALESCE(reviewed_at, NOW())
        FROM ranked
        WHERE va_rates.id = ranked.id AND ranked.rn > 1
        """
    )
    op.create_index(
        "uq_va_rates_one_approved_per_pair",
        "va_rates",
        ["va_id", "client_id"],
        unique=True,
        postgresql_where=sa.text("status = 'approved'"),
    )


def downgrade() -> None:
    op.drop_index("uq_va_rates_one_approved_per_pair", table_name="va_rates")
    op.drop_column("tasks", "parent_task_id")
    op.drop_column("tasks", "series_id")
    op.drop_column("tasks", "recurrence_until")
    op.drop_column("tasks", "recurrence_weekdays")
    op.drop_column("tasks", "recurrence_unit")
    op.drop_column("tasks", "recurrence_interval")
    op.drop_column("tasks", "recurrence")
    op.execute("DROP TYPE IF EXISTS task_recurrence")
