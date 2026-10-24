"""Time clock correction requests + original times on entries

Revision ID: 022
Revises: 021
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "022"
down_revision: Union[str, None] = "021"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("time_clock_entries", sa.Column("original_clock_in", sa.DateTime(timezone=True), nullable=True))
    op.add_column("time_clock_entries", sa.Column("original_clock_out", sa.DateTime(timezone=True), nullable=True))
    op.add_column("time_clock_entries", sa.Column("last_adjusted_by_name", sa.String(255), nullable=True))
    op.add_column("time_clock_entries", sa.Column("last_adjusted_by_role", sa.String(30), nullable=True))

    op.create_table(
        "time_clock_correction_requests",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("entry_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("time_clock_entries.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("va_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("vas.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("requested_by_user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("proposed_clock_in", sa.DateTime(timezone=True), nullable=True),
        sa.Column("proposed_clock_out", sa.DateTime(timezone=True), nullable=True),
        sa.Column("proposed_notes", sa.Text(), nullable=True),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default="pending"),
        sa.Column("resolved_by_user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("resolved_by_name", sa.String(255), nullable=True),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("resolution_note", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("time_clock_correction_requests")
    op.drop_column("time_clock_entries", "last_adjusted_by_role")
    op.drop_column("time_clock_entries", "last_adjusted_by_name")
    op.drop_column("time_clock_entries", "original_clock_out")
    op.drop_column("time_clock_entries", "original_clock_in")
