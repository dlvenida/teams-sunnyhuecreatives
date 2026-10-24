"""Work log payable_on rollover + user notification preferences

Revision ID: 023
Revises: 022
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "023"
down_revision: Union[str, None] = "022"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("work_logs", sa.Column("payable_on", sa.Date(), nullable=True))
    op.create_index("ix_work_logs_payable_on", "work_logs", ["payable_on"])
    op.add_column(
        "users",
        sa.Column("notification_preferences", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("users", "notification_preferences")
    op.drop_index("ix_work_logs_payable_on", table_name="work_logs")
    op.drop_column("work_logs", "payable_on")
