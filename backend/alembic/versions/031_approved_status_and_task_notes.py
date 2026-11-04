"""Approved task status and staff note history

Revision ID: 031
Revises: 030

030 is the Fixed Package period override migration. This revision stays after it
so the two branches share one Alembic head once both are on main.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "031"
down_revision: Union[str, None] = "030"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # New enum values cannot be used in the same transaction on older Postgres.
    with op.get_context().autocommit_block():
        op.execute("ALTER TYPE task_status ADD VALUE IF NOT EXISTS 'approved' BEFORE 'done'")
    op.add_column("tasks", sa.Column("staff_notes", sa.Text(), nullable=True))
    op.add_column("tasks", sa.Column("staff_notes_updated_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("tasks", sa.Column("staff_notes_updated_by", postgresql.UUID(as_uuid=True), nullable=True))
    op.add_column("tasks", sa.Column("staff_notes_updated_by_name", sa.String(length=255), nullable=True))
    op.create_foreign_key(
        "fk_tasks_staff_notes_updated_by",
        "tasks",
        "users",
        ["staff_notes_updated_by"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_table(
        "task_note_revisions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("task_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("body", sa.Text(), nullable=False, server_default=""),
        sa.Column("editor_user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("editor_name", sa.String(length=255), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )


def downgrade() -> None:
    op.drop_table("task_note_revisions")
    op.drop_constraint("fk_tasks_staff_notes_updated_by", "tasks", type_="foreignkey")
    op.drop_column("tasks", "staff_notes_updated_by_name")
    op.drop_column("tasks", "staff_notes_updated_by")
    op.drop_column("tasks", "staff_notes_updated_at")
    op.drop_column("tasks", "staff_notes")
    # Postgres cannot drop a single enum value without recreating the type.
