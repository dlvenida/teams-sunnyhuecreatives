"""user reports to admin/auditor + time clock adjustments audit

Revision ID: 011
Revises: 010
"""
from typing import Sequence, Union
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "011"
down_revision: Union[str, None] = "010"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "user_reports",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("reporter_user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("reporter_va_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("vas.id", ondelete="SET NULL"), nullable=True),
        sa.Column("reporter_name", sa.String(255), server_default=""),
        sa.Column("reporter_role", sa.String(30), server_default="va"),
        sa.Column("category", sa.String(50), server_default="general"),
        sa.Column("title", sa.String(500), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("client_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("clients.id", ondelete="SET NULL"), nullable=True),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("projects.id", ondelete="SET NULL"), nullable=True),
        sa.Column("task_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tasks.id", ondelete="SET NULL"), nullable=True),
        sa.Column("status", sa.String(30), server_default="open", index=True),
        sa.Column("admin_note", sa.Text(), nullable=True),
        sa.Column("handled_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_table(
        "time_clock_adjustments",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("entry_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("time_clock_entries.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("va_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("vas.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("adjusted_by_user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("adjusted_by_name", sa.String(255), server_default=""),
        sa.Column("adjusted_by_role", sa.String(30), server_default="va"),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("before", postgresql.JSONB(), nullable=True),
        sa.Column("after", postgresql.JSONB(), nullable=True),
        sa.Column("work_log_synced", sa.Boolean(), server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.add_column("time_clock_entries", sa.Column("is_adjusted", sa.Boolean(), server_default=sa.false()))
    op.add_column("time_clock_entries", sa.Column("adjustment_count", sa.Integer(), server_default="0"))
    op.add_column("time_clock_entries", sa.Column("last_adjusted_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("time_clock_entries", sa.Column("last_adjustment_reason", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("time_clock_entries", "last_adjustment_reason")
    op.drop_column("time_clock_entries", "last_adjusted_at")
    op.drop_column("time_clock_entries", "adjustment_count")
    op.drop_column("time_clock_entries", "is_adjusted")
    op.drop_table("time_clock_adjustments")
    op.drop_table("user_reports")
