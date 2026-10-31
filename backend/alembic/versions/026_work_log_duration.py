"""Manual time logs can store a duration without start and end times

Revision ID: 026
Revises: 025
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "026"
down_revision: Union[str, None] = "025"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "work_logs",
        sa.Column("entry_mode", sa.String(length=20), nullable=False, server_default="range"),
    )
    op.alter_column("work_logs", "start_time", existing_type=sa.Time(), nullable=True)
    op.alter_column("work_logs", "end_time", existing_type=sa.Time(), nullable=True)


def downgrade() -> None:
    op.execute("UPDATE work_logs SET start_time = '00:00:00' WHERE start_time IS NULL")
    op.execute("UPDATE work_logs SET end_time = '00:00:00' WHERE end_time IS NULL")
    op.alter_column("work_logs", "start_time", existing_type=sa.Time(), nullable=False)
    op.alter_column("work_logs", "end_time", existing_type=sa.Time(), nullable=False)
    op.drop_column("work_logs", "entry_mode")
