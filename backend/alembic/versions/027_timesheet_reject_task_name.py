"""Timesheet rejection note + work-log task name

Revision ID: 027
Revises: 026

Renumbered from 024: production already applied designer-notes
revisions 024-026 (legal name, assignee role, work-log duration).
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "027"
down_revision: Union[str, None] = "026"
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
