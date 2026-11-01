"""Timesheet rejection note + work-log task name

Revision ID: 024
Revises: 023
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "024"
down_revision: Union[str, None] = "023"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.get_context().autocommit_block():
        op.execute("ALTER TYPE timesheet_status ADD VALUE IF NOT EXISTS 'rejected'")
    op.add_column("timesheet_submissions", sa.Column("review_note", sa.Text(), nullable=True))
    op.add_column("work_logs", sa.Column("task_name", sa.String(255), nullable=True))


def downgrade() -> None:
    op.drop_column("work_logs", "task_name")
    op.drop_column("timesheet_submissions", "review_note")
    # Postgres cannot drop a single enum value safely; leave 'rejected' in place.
