"""Remember why a review log was sent back

Revision ID: 040
Revises: 039

Adds a history table only. Existing work logs are not changed.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "040"
down_revision: Union[str, None] = "039"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "work_log_rejections",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("work_log_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("work_logs.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("reasons", postgresql.JSONB(), nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("rejected_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("rejected_by_name", sa.String(255), nullable=False, server_default=""),
        sa.Column("rejected_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("work_log_rejections")
