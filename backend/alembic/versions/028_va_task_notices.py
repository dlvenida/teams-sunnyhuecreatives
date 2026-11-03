"""VA task notices remember which deadline was already sent

Revision ID: 028
Revises: 027
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "028"
down_revision: Union[str, None] = "027"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("notifications", sa.Column("event_key", sa.String(length=40), nullable=True))
    op.create_table(
        "task_deadline_alerts",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("task_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("kind", sa.String(length=20), nullable=False),
        sa.Column("due_date", sa.Date(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("task_id", "kind", "due_date", name="uq_task_deadline_alert"),
    )


def downgrade() -> None:
    op.drop_table("task_deadline_alerts")
    op.drop_column("notifications", "event_key")
