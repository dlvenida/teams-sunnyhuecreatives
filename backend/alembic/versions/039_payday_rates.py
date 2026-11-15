"""One confirmed payday rate per payroll period

Revision ID: 039
Revises: 038
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "039"
down_revision: Union[str, None] = "038"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "payday_rates",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("period_start", sa.Date(), nullable=False),
        sa.Column("period_end", sa.Date(), nullable=False),
        sa.Column("usd_php_rate", sa.Numeric(12, 4), nullable=False),
        sa.Column("confirmed_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("confirmed_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.UniqueConstraint("period_start", "period_end", name="uq_payday_rate_period"),
    )
    op.create_index("ix_payday_rates_period_start", "payday_rates", ["period_start"])
    op.create_index("ix_payday_rates_period_end", "payday_rates", ["period_end"])


def downgrade() -> None:
    op.drop_index("ix_payday_rates_period_end", table_name="payday_rates")
    op.drop_index("ix_payday_rates_period_start", table_name="payday_rates")
    op.drop_table("payday_rates")
